import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Supabase Admin Client
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Security Headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "img-src": ["'self'", "data:", "https://picsum.photos", "https://*.supabase.co"],
        "connect-src": ["'self'", "https://*.supabase.co", "https://*.run.app"],
        "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // unsafe-eval needed for some dev tools
      },
    },
    crossOriginEmbedderPolicy: false, // Needed for some external assets
  }));

  // Rate Limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again after 15 minutes',
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', limiter);

  app.use(express.json());

  // API Route to bootstrap the admin user
  app.post('/api/admin/bootstrap', async (req, res) => {
    const { bootstrapKey } = req.body;

    // Verify bootstrap key
    if (!process.env.ADMIN_BOOTSTRAP_KEY || bootstrapKey !== process.env.ADMIN_BOOTSTRAP_KEY) {
      console.warn('Unauthorized bootstrap attempt');
      return res.status(401).json({ error: 'Unauthorized. Invalid bootstrap key.' });
    }

    const adminEmail = process.env.INITIAL_ADMIN_EMAIL || 'admin@procrm.com';
    const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || 'Password@1';

    try {
      // Check if admin already exists in Auth
      const { data: users, error: listError } = await supabaseAdmin.auth.admin.listUsers();
      if (listError) throw listError;

      let adminUser = (users.users as any[]).find(u => u.email === adminEmail);

      if (!adminUser) {
        // User doesn't exist, create it
        const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: adminEmail,
          password: adminPassword,
          email_confirm: true,
          user_metadata: { displayName: 'System Admin' }
        });
        if (createError) throw createError;
        adminUser = newUser.user;
      }

      // Ensure profile exists in 'profiles' table
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .upsert({
          uid: adminUser.id,
          email: adminUser.email,
          displayName: adminUser.user_metadata.displayName || 'System Admin',
          role: 'admin',
          createdAt: new Date().toISOString(),
        }, { onConflict: 'uid' });

      if (profileError) {
        if (profileError.message.includes("Could not find the table 'public.profiles'")) {
          return res.status(400).json({ 
            error: "Database table 'profiles' is missing. Please run the SQL setup script in your project dashboard." 
          });
        }
        throw profileError;
      }

      res.json({ success: true, message: 'Admin user bootstrapped successfully.' });
    } catch (error: any) {
      console.error('Error bootstrapping admin:', error);
      res.status(500).json({ error: 'Internal Server Error' }); // Don't leak error details
    }
  });

  // Helper to check if user can edit (admin or manager)
  async function checkCanEdit(req: express.Request) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { error: 'Unauthorized. Missing or invalid token.', status: 401 };
    }
    const idToken = authHeader.split(' ')[1];

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(idToken);
    if (authError || !user) return { error: 'Unauthorized. Invalid token.', status: 401 };

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('uid', user.id)
      .single();

    if (profileError || !profile) return { error: 'Unauthorized. Profile not found.', status: 403 };
    if (profile.role !== 'admin' && profile.role !== 'manager') {
      return { error: 'Unauthorized. Admin or Manager only.', status: 403 };
    }

    return { user, profile };
  }

  // API Route to create a user (Admin only)
  app.post('/api/admin/create-user', async (req, res) => {
    const { email, password, displayName, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }

    // Basic password strength check
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    try {
      const auth = await checkCanEdit(req);
      if ('error' in auth) return res.status(auth.status).json({ error: auth.error });
      if (auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });

      // Create user in Supabase Auth
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { displayName }
      });

      if (createError) throw createError;

      // Create user profile in 'profiles' table
      const { error: insertError } = await supabaseAdmin
        .from('profiles')
        .insert([{
          uid: newUser.user.id,
          email: newUser.user.email,
          displayName: displayName || newUser.user.email?.split('@')[0] || 'User',
          role: role || 'viewer',
          createdAt: new Date().toISOString(),
        }]);

      if (insertError) throw insertError;

      res.json({ success: true, uid: newUser.user.id });
    } catch (error: any) {
      console.error('Error creating user:', error);
      res.status(500).json({ error: 'Failed to create user.' });
    }
  });

  // API Route to delete a user (Admin only)
  app.post('/api/admin/delete-user', async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    try {
      const auth = await checkCanEdit(req);
      if ('error' in auth) return res.status(auth.status).json({ error: auth.error });
      if (auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });

      // Prevent admin from deleting themselves
      if (userId === auth.user.id) {
        return res.status(400).json({ error: 'Cannot delete your own account.' });
      }

      // Delete user from Supabase Auth
      const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (deleteAuthError) throw deleteAuthError;

      // Delete user profile from 'profiles' table
      const { error: deleteProfileError } = await supabaseAdmin
        .from('profiles')
        .delete()
        .eq('uid', userId);

      if (deleteProfileError) throw deleteProfileError;

      res.json({ success: true });
    } catch (error: any) {
      console.error('Error deleting user:', error);
      res.status(500).json({ error: 'Failed to delete user.' });
    }
  });

  // API Route to update user role (Admin only)
  app.post('/api/admin/update-role', async (req, res) => {
    const { userId, role } = req.body;

    if (!userId || !role) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    try {
      const auth = await checkCanEdit(req);
      if ('error' in auth) return res.status(auth.status).json({ error: auth.error });
      if (auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });

      // Prevent admin from changing their own role (to prevent accidental lockout)
      if (userId === auth.user.id) {
        return res.status(400).json({ error: 'Cannot change your own role.' });
      }

      // Update user profile in 'profiles' table
      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({ role })
        .eq('uid', userId);

      if (updateError) throw updateError;

      res.json({ success: true });
    } catch (error: any) {
      console.error('Error updating role:', error);
      res.status(500).json({ error: 'Failed to update role.' });
    }
  });

  // --- Product API Endpoints ---

  app.post('/api/products', async (req, res) => {
    const { product } = req.body;
    if (!product || !product.name || product.price === undefined || product.stock === undefined) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    if (typeof product.price !== 'number' || product.price < 0) {
      return res.status(400).json({ error: 'Invalid price.' });
    }

    if (typeof product.stock !== 'number' || product.stock < 0) {
      return res.status(400).json({ error: 'Invalid stock.' });
    }

    try {
      const auth = await checkCanEdit(req);
      if ('error' in auth) return res.status(auth.status).json({ error: auth.error });

      const { data, error } = await supabaseAdmin
        .from('products')
        .insert([{ ...product, user_id: auth.user.id, updatedAt: new Date().toISOString() }])
        .select()
        .single();

      if (error) throw error;
      res.json({ success: true, data });
    } catch (error: any) {
      console.error('Error creating product:', error);
      res.status(500).json({ error: 'Failed to create product.' });
    }
  });

  app.put('/api/products/:id', async (req, res) => {
    const { id } = req.params;
    const { product } = req.body;
    if (!product || !product.name || product.price === undefined || product.stock === undefined) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    if (typeof product.price !== 'number' || product.price < 0) {
      return res.status(400).json({ error: 'Invalid price.' });
    }

    if (typeof product.stock !== 'number' || product.stock < 0) {
      return res.status(400).json({ error: 'Invalid stock.' });
    }

    try {
      const auth = await checkCanEdit(req);
      if ('error' in auth) return res.status(auth.status).json({ error: auth.error });

      const { data, error } = await supabaseAdmin
        .from('products')
        .update({ ...product, updatedAt: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      res.json({ success: true, data });
    } catch (error: any) {
      console.error('Error updating product:', error);
      res.status(500).json({ error: 'Failed to update product.' });
    }
  });

  app.delete('/api/products/:id', async (req, res) => {
    const { id } = req.params;

    try {
      const auth = await checkCanEdit(req);
      if ('error' in auth) return res.status(auth.status).json({ error: auth.error });

      const { error } = await supabaseAdmin
        .from('products')
        .delete()
        .eq('id', id);

      if (error) throw error;
      res.json({ success: true });
    } catch (error: any) {
      console.error('Error deleting product:', error);
      res.status(500).json({ error: 'Failed to delete product.' });
    }
  });

  app.delete('/api/products', async (req, res) => {
    try {
      const auth = await checkCanEdit(req);
      if ('error' in auth) return res.status(auth.status).json({ error: auth.error });
      if (auth.profile.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });

      const { error } = await supabaseAdmin
        .from('products')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

      if (error) throw error;
      res.json({ success: true });
    } catch (error: any) {
      console.error('Error deleting all products:', error);
      res.status(500).json({ error: 'Failed to delete all products.' });
    }
  });

  // --- Invoice API Endpoints ---

  app.post('/api/invoices', async (req, res) => {
    const { invoice } = req.body;
    if (!invoice || !invoice.customerName || !invoice.items || !Array.isArray(invoice.items) || invoice.items.length === 0) {
      return res.status(400).json({ error: 'Missing required fields or invalid items.' });
    }

    try {
      const auth = await checkCanEdit(req);
      if ('error' in auth) return res.status(auth.status).json({ error: auth.error });

      // Atomic operation: Create invoice and update stock
      // In a real production app, this should be a database transaction or a stored procedure (RPC)
      // Since we are using Supabase, we can use an RPC if needed, but for now we'll do it sequentially
      // with careful checks.

      // 1. Check stock for all items
      for (const item of invoice.items) {
        const { data: product, error: fetchError } = await supabaseAdmin
          .from('products')
          .select('stock, name')
          .eq('id', item.productId)
          .single();
        
        if (fetchError || !product) throw new Error(`Product ${item.productId} not found.`);
        if (product.stock < item.quantity) {
          return res.status(400).json({ error: `Insufficient stock for ${product.name}.` });
        }
      }

      // 2. Insert Invoice
      const { data: newInvoice, error: invoiceError } = await supabaseAdmin
        .from('invoices')
        .insert([{ ...invoice, createdBy: auth.user.id, createdAt: new Date().toISOString() }])
        .select()
        .single();

      if (invoiceError) throw invoiceError;

      // 3. Update Stock
      for (const item of invoice.items) {
        const { data: currentProduct } = await supabaseAdmin
          .from('products')
          .select('stock')
          .eq('id', item.productId)
          .single();
        
        if (currentProduct) {
          await supabaseAdmin
            .from('products')
            .update({ stock: currentProduct.stock - item.quantity })
            .eq('id', item.productId);
        }
      }

      res.json({ success: true, data: newInvoice });
    } catch (error: any) {
      console.error('Error creating invoice:', error);
      res.status(500).json({ error: 'Failed to create invoice.' });
    }
  });

  app.put('/api/invoices/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Missing required fields.' });

    try {
      const auth = await checkCanEdit(req);
      if ('error' in auth) return res.status(auth.status).json({ error: auth.error });

      const { error } = await supabaseAdmin
        .from('invoices')
        .update({ status })
        .eq('id', id);

      if (error) throw error;
      res.json({ success: true });
    } catch (error: any) {
      console.error('Error updating invoice status:', error);
      res.status(500).json({ error: 'Failed to update invoice status.' });
    }
  });

  app.delete('/api/invoices/:id', async (req, res) => {
    const { id } = req.params;

    try {
      const auth = await checkCanEdit(req);
      if ('error' in auth) return res.status(auth.status).json({ error: auth.error });

      // 1. Fetch invoice to get items for stock reversal
      const { data: invoice, error: fetchError } = await supabaseAdmin
        .from('invoices')
        .select('items')
        .eq('id', id)
        .single();
      
      if (fetchError || !invoice) throw new Error('Invoice not found.');

      // 2. Reverse stock
      for (const item of invoice.items) {
        const { data: product } = await supabaseAdmin
          .from('products')
          .select('stock')
          .eq('id', item.productId)
          .single();
        
        if (product) {
          await supabaseAdmin
            .from('products')
            .update({ stock: product.stock + item.quantity })
            .eq('id', item.productId);
        }
      }

      // 3. Delete invoice
      const { error: deleteError } = await supabaseAdmin
        .from('invoices')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      res.json({ success: true });
    } catch (error: any) {
      console.error('Error deleting invoice:', error);
      res.status(500).json({ error: 'Failed to delete invoice.' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

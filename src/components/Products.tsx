import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Product, UserProfile } from '../types';
import { formatCurrency, cn } from '../lib/utils';
import { ConfirmationModal } from './ConfirmationModal';
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  Package, 
  X,
  Loader2,
  AlertCircle
} from 'lucide-react';

interface ProductsProps {
  profile: UserProfile;
}

export function Products({ profile }: ProductsProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [formData, setFormData] = useState<any>({
    name: '',
    description: '',
    price: '',
    stock: '',
    category: ''
  });

  const [category, setCategory] = useState('');
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<string | null>(null);
  const [deleteAllModalOpen, setDeleteAllModalOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const canEdit = profile.role === 'admin' || profile.role === 'manager';
  const isAdmin = profile.role === 'admin';

  function sortProducts(list: Product[]) {
    // "Newest first" so that newly created products appear at the top row.
    // updatedAt is set by the server on insert/update.
    return [...list].sort((a, b) => {
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      if (bTime !== aTime) return bTime - aTime; // descending
      return a.name.localeCompare(b.name); // stable tie-breaker
    });
  }

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          // Ordering isn't guaranteed to match our UI needs; we sort client-side.
          // (Also avoids hard dependency on a "name" sort.)
          // .order('updatedAt', { ascending: false });
        
        if (error) throw error;
        if (data) setProducts(sortProducts(data as Product[]));
      } catch (error) {
        console.error('Error fetching products:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();

    const subscription = supabase
      .channel('products-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setProducts(prev => {
            if (prev.some(p => p.id === payload.new.id)) return prev;
            return sortProducts([...prev, payload.new as Product]);
          });
        } else if (payload.eventType === 'UPDATE') {
          setProducts(prev => sortProducts(prev.map(p => p.id === payload.new.id ? payload.new as Product : p)));
        } else if (payload.eventType === 'DELETE') {
          setProducts(prev => prev.filter(p => p.id !== payload.old.id));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || submitLoading) return;
    setFormError('');

    // Validation
    if (!formData.name.trim()) {
      setFormError('Product name is required.');
      return;
    }
    
    const price = parseFloat(formData.price);
    const stock = parseInt(formData.stock);

    if (isNaN(price) || price < 0) {
      setFormError('Please enter a valid price.');
      return;
    }
    if (isNaN(stock) || stock < 0) {
      setFormError('Please enter a valid stock number.');
      return;
    }

    setSubmitLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const idToken = session?.access_token;

      if (!idToken) throw new Error('No authentication session found.');

      const productPayload = {
        ...formData,
        price,
        stock
      };

      if (editingProduct) {
        const response = await fetch(`/api/products/${editingProduct.id}`, {
          method: 'PUT',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({ product: productPayload })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Failed to update product');
        
        if (result.data) {
          setProducts(prev => sortProducts(prev.map(p => p.id === result.data.id ? result.data as Product : p)));
        }
      } else {
        const response = await fetch('/api/products', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({ product: productPayload })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Failed to create product');

        if (result.data) {
          setProducts(prev => {
            const next = result.data as Product;
            if (prev.some(p => p.id === next.id)) return sortProducts(prev);
            return sortProducts([...prev, next]);
          });
        }
      }
      setIsModalOpen(false);
      setEditingProduct(null);
      setFormData({ name: '', description: '', price: '', stock: '', category: '' });
    } catch (error: any) {
      console.error('Error saving product:', error);
      setFormError(error.message || 'Failed to save product. Please try again.');
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!canEdit || !productToDelete) return;
    
    setDeleteLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const idToken = session?.access_token;

      if (!idToken) throw new Error('No authentication session found.');

      const response = await fetch(`/api/products/${productToDelete}`, {
        method: 'DELETE',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        }
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to delete product');
      
      setProducts(prev => prev.filter(p => p.id !== productToDelete));
      setDeleteModalOpen(false);
      setProductToDelete(null);
    } catch (error: any) {
      console.error('Error deleting product:', error);
      setFormError('Failed to delete product: ' + error.message);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleDeleteAll = async () => {
    if (!isAdmin) return;
    
    setDeleteLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const idToken = session?.access_token;

      if (!idToken) throw new Error('No authentication session found.');

      const response = await fetch('/api/products', {
        method: 'DELETE',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        }
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to delete products');

      setProducts([]);
      setDeleteAllModalOpen(false);
    } catch (error: any) {
      console.error('Error deleting all products:', error);
      setFormError('Failed to delete products: ' + error.message);
    } finally {
      setDeleteLoading(false);
    }
  };

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
                         (p.description && p.description.toLowerCase().includes(search.toLowerCase())) ||
                         (p.category && p.category.toLowerCase().includes(search.toLowerCase()));
    return matchesSearch;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Products</h1>
          <p className="text-zinc-500">Manage your inventory and pricing.</p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && products.length > 0 && (
            <button
              onClick={() => setDeleteAllModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 rounded-xl hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete All
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => {
                setEditingProduct(null);
                setFormData({ name: '', description: '', price: '', stock: '', category: '' });
                setIsModalOpen(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl hover:bg-zinc-800 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Product
            </button>
          )}
        </div>
      </div>

      {/* Search and Filters */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <input
          type="text"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-white border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5 transition-all"
        />
      </div>

      {/* Products Table */}
      <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200">
                <th className="px-6 py-4 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Product</th>
                <th className="px-6 py-4 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Category</th>
                <th className="px-6 py-4 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Price</th>
                <th className="px-6 py-4 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Stock</th>
                <th className="px-6 py-4 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Status</th>
                {canEdit && <th className="px-6 py-4 text-xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredProducts.map((product) => (
                <tr key={product.id} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-zinc-100 rounded-lg flex items-center justify-center">
                        <Package className="w-5 h-5 text-zinc-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-zinc-900">{product.name}</p>
                        <p className="text-xs text-zinc-500 truncate max-w-[200px]">{product.description}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 bg-zinc-100 text-zinc-600 rounded-md text-xs font-medium">
                      {product.category || 'Uncategorized'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-900 font-medium">
                    {formatCurrency(product.price)}
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-600">
                    {product.stock}
                  </td>
                  <td className="px-6 py-4">
                    {product.stock <= 5 ? (
                      <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600">
                        <AlertCircle className="w-3 h-3" />
                        Low Stock
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-emerald-600">In Stock</span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            setEditingProduct(product);
                            setFormData({
                              name: product.name,
                              description: product.description,
                              price: product.price,
                              stock: product.stock,
                              category: product.category
                            });
                            setIsModalOpen(true);
                          }}
                          className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            setProductToDelete(product.id);
                            setDeleteModalOpen(true);
                          }}
                          className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {filteredProducts.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-zinc-500">
                    No products found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      <ConfirmationModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDelete}
        isLoading={deleteLoading}
        title="Delete Product"
        message="Are you sure you want to delete this product? This action cannot be undone."
        confirmText="Delete"
      />

      <ConfirmationModal
        isOpen={deleteAllModalOpen}
        onClose={() => setDeleteAllModalOpen(false)}
        onConfirm={handleDeleteAll}
        isLoading={deleteLoading}
        title="Delete All Products"
        message="Are you sure you want to delete ALL products? This action will permanently remove everything from your inventory."
        confirmText="Delete Everything"
      />

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-zinc-900">
                {editingProduct ? 'Edit Product' : 'Add New Product'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-zinc-100 rounded-lg">
                <X className="w-5 h-5 text-zinc-400" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {formError}
                </div>
              )}
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-700">Product Name</label>
                <input
                  required
                  type="text"
                  placeholder="Enter product name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5 placeholder:text-zinc-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-700">Description</label>
                <textarea
                  placeholder="Write a brief description..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5 h-24 resize-none placeholder:text-zinc-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-700">Price (PKR)</label>
                  <input
                    required
                    type="number"
                    placeholder="0.00"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5 placeholder:text-zinc-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-700">Stock</label>
                  <input
                    required
                    type="number"
                    placeholder="0"
                    value={formData.stock}
                    onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                    className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5 placeholder:text-zinc-400"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-700">Category</label>
                <input
                  type="text"
                  placeholder="Electronics, Fashion, etc."
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/5 placeholder:text-zinc-400"
                />
              </div>
              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  disabled={submitLoading}
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2 px-4 border border-zinc-200 text-zinc-600 rounded-xl hover:bg-zinc-50 font-medium disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitLoading}
                  className="flex-1 py-2 px-4 bg-zinc-900 text-white rounded-xl hover:bg-zinc-800 font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {submitLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingProduct ? 'Save Changes' : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

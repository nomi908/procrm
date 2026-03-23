import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../lib/supabase';
import { Invoice, Product, UserProfile, InvoiceItem, InvoiceStatus } from '../types';
import { formatCurrency, cn } from '../lib/utils';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ConfirmationModal } from './ConfirmationModal';
import { 
  Plus, 
  Search, 
  FileText, 
  X,
  ChevronRight,
  Printer,
  CheckCircle2,
  Clock,
  Download,
  Trash2,
  Loader2,
  AlertCircle,
  Filter
} from 'lucide-react';

interface InvoicesProps {
  profile: UserProfile;
}

export function Invoices({ profile }: InvoicesProps) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [statusLoading, setStatusLoading] = useState<string | null>(null);
  const [invoiceToDelete, setInvoiceToDelete] = useState<Invoice | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'all' | InvoiceStatus>('all');
  
  // Form State
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [invoiceStatus, setInvoiceStatus] = useState<InvoiceStatus>('draft');
  const [selectedItems, setSelectedItems] = useState<InvoiceItem[]>([]);
  const [currentStep, setCurrentStep] = useState(1);
  const [productSearch, setProductSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  const canEdit = profile.role === 'admin' || profile.role === 'manager';

  const categories = ['All', ...Array.from(new Set(products.map(p => p.category)))];

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [invoicesRes, productsRes] = await Promise.all([
          supabase.from('invoices').select('*').order('createdAt', { ascending: false }).limit(100),
          supabase.from('products').select('*').order('name', { ascending: true })
        ]);

        if (invoicesRes.error) throw invoicesRes.error;
        if (productsRes.error) throw productsRes.error;

        if (invoicesRes.data) setInvoices(invoicesRes.data as Invoice[]);
        if (productsRes.data) setProducts(productsRes.data as Product[]);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    const invoicesSubscription = supabase
      .channel('invoices-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setInvoices(prev => {
            if (prev.some(inv => inv.id === payload.new.id)) return prev;
            return [payload.new as Invoice, ...prev];
          });
        } else if (payload.eventType === 'UPDATE') {
          setInvoices(prev => prev.map(inv => inv.id === payload.new.id ? payload.new as Invoice : inv));
        } else if (payload.eventType === 'DELETE') {
          setInvoices(prev => prev.filter(inv => inv.id !== payload.old.id));
        }
      })
      .subscribe();

    const productsSubscription = supabase
      .channel('products-invoices')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setProducts(prev => {
            if (prev.some(p => p.id === payload.new.id)) return prev;
            return [...prev, payload.new as Product].sort((a, b) => a.name.localeCompare(b.name));
          });
        } else if (payload.eventType === 'UPDATE') {
          setProducts(prev => prev.map(p => p.id === payload.new.id ? payload.new as Product : p));
        } else if (payload.eventType === 'DELETE') {
          setProducts(prev => prev.filter(p => p.id !== payload.old.id));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(invoicesSubscription);
      supabase.removeChannel(productsSubscription);
    };
  }, []);

  const addItem = (product: Product) => {
    const existing = selectedItems.find(i => i.productId === product.id);
    const currentQty = existing ? existing.quantity : 0;

    if (currentQty + 1 > product.stock) {
      setFormError(`Cannot add more. Only ${product.stock} units available in stock for ${product.name}.`);
      return;
    }

    setFormError('');
    if (existing) {
      setSelectedItems(selectedItems.map(i => 
        i.productId === product.id 
          ? { ...i, quantity: i.quantity + 1, total: (i.quantity + 1) * i.price }
          : i
      ));
    } else {
      setSelectedItems([...selectedItems, {
        productId: product.id,
        productName: product.name,
        quantity: 1,
        price: product.price,
        total: product.price
      }]);
    }
  };

  const removeItem = (productId: string) => {
    setSelectedItems(selectedItems.filter(i => i.productId !== productId));
  };

  const updateQuantity = (productId: string, q: number) => {
    const product = products.find(p => p.id === productId);
    const quantity = Math.max(1, q);

    if (product && quantity > product.stock) {
      setFormError(`Only ${product.stock} units available in stock for ${product.name}.`);
      return;
    }

    setFormError('');
    setSelectedItems(selectedItems.map(i => 
      i.productId === productId 
        ? { ...i, quantity, total: quantity * i.price }
        : i
    ));
  };

  const total = selectedItems.reduce((sum, i) => sum + i.total, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || submitLoading) return;
    setFormError('');

    // Validation
    if (!customerName.trim()) {
      setFormError('Customer name is required.');
      return;
    }
    if (selectedItems.length === 0) {
      setFormError('Please add at least one item to the invoice.');
      return;
    }

    // Check stock for all items
    for (const item of selectedItems) {
      const product = products.find(p => p.id === item.productId);
      if (product && product.stock < item.quantity) {
        setFormError(`Insufficient stock for ${product.name}. Available: ${product.stock}`);
        return;
      }
    }

    setSubmitLoading(true);
    const invoiceNumber = `INV-${Math.floor(100000 + Math.random() * 900000)}`;
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const idToken = session?.access_token;

      if (!idToken) throw new Error('No authentication session found.');

      const newInvoice = {
        invoiceNumber,
        customerName,
        customerEmail: customerEmail.trim() || '',
        items: selectedItems,
        subtotal: total,
        tax: 0,
        total,
        status: invoiceStatus
      };

      const response = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ invoice: newInvoice })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to create invoice');
      
      if (result.data) {
        setInvoices(prev => [result.data as Invoice, ...prev]);
      }
      
      setIsModalOpen(false);
      resetForm();
    } catch (error: any) {
      console.error('Error creating invoice:', error);
      setFormError(error.message || 'Failed to create invoice. Please try again.');
    } finally {
      setSubmitLoading(false);
    }
  };

  const resetForm = () => {
    setCustomerName('');
    setCustomerEmail('');
    setInvoiceStatus('draft');
    setSelectedItems([]);
    setFormError('');
    setProductSearch('');
    setSelectedCategory('All');
    setCurrentStep(1);
  };

  const updateStatus = async (id: string, status: InvoiceStatus) => {
    if (!canEdit || statusLoading) return;
    setStatusLoading(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const idToken = session?.access_token;

      if (!idToken) throw new Error('No authentication session found.');

      const response = await fetch(`/api/invoices/${id}/status`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ status })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to update status');
      
      // Manually update status in state as fallback for real-time
      setInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, status } : inv));

      if (viewingInvoice?.id === id) {
        setViewingInvoice({ ...viewingInvoice, status });
      }
    } catch (error: any) {
      console.error('Error updating status:', error);
    } finally {
      setStatusLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!canEdit || !invoiceToDelete || deleteLoading) return;
    setDeleteLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const idToken = session?.access_token;

      if (!idToken) throw new Error('No authentication session found.');

      const response = await fetch(`/api/invoices/${invoiceToDelete.id}`, {
        method: 'DELETE',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        }
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to delete invoice');
      
      setInvoices(prev => prev.filter(inv => inv.id !== invoiceToDelete.id));
      setInvoiceToDelete(null);
      if (viewingInvoice?.id === invoiceToDelete.id) {
        setViewingInvoice(null);
      }
    } catch (error: any) {
      console.error('Error deleting invoice:', error);
    } finally {
      setDeleteLoading(false);
    }
  };

  const createInvoicePDF = (invoice: Invoice, opts: { includeStatus: boolean }) => {
    const doc = new jsPDF();

    // Header
    doc.setFontSize(22);
    doc.setTextColor(20, 20, 20);
    doc.text('INVOICE', 14, 22);

    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Invoice #: ${invoice.invoiceNumber}`, 14, 30);
    doc.text(`Date: ${new Date(invoice.createdAt).toLocaleDateString()}`, 14, 35);
    if (opts.includeStatus) {
      doc.text(`Status: ${invoice.status.toUpperCase()}`, 14, 40);
    }

    // Row layout: put ProCRM and BILL TO on the same horizontal line.
    const rowY = 55;
    const rightX = 110;

    // Left: Company
    doc.setFontSize(12);
    doc.setTextColor(20, 20, 20);
    doc.text('Javed Sanitary & Tiles', 14, rowY);

    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text('G-8/1 I&T Center Islamabad', 14, rowY + 7);
    doc.text('+92 321 5057158', 14, rowY + 12);
    doc.text('javedsanitaryntiles@gmail.com', 14, rowY + 17);

    // Right: Bill To
    doc.setFontSize(10);
    doc.setTextColor(150, 150, 150);
    doc.text('BILL TO:', rightX, rowY);

    doc.setFontSize(12);
    doc.setTextColor(20, 20, 20);
    doc.text(invoice.customerName, rightX, rowY + 7);

    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(invoice.customerEmail || 'No email provided', rightX, rowY + 13);

    const pageWidth = doc.internal.pageSize.getWidth();

    // Table
    autoTable(doc, {
      startY: 88,
      margin: { left: 14, right: 14 },
      head: [['Item', 'Qty', 'Price', 'Total']],
      body: invoice.items.map(item => [
        item.productName,
        item.quantity,
        formatCurrency(item.price),
        formatCurrency(item.total)
      ]),
      headStyles: { fillColor: [20, 20, 20], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 3, overflow: 'linebreak', valign: 'middle' },
      columnStyles: {
        0: { halign: 'left', cellWidth: 90 },   // Item
        1: { halign: 'center', cellWidth: 20 }, // Qty
        2: { halign: 'right', cellWidth: 35 },  // Price
        3: { halign: 'right', cellWidth: 35 },  // Total
      }
    });

    // Total
    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(12);
    doc.setTextColor(20, 20, 20);
    doc.setFont('helvetica', 'bold');
    doc.text(
      `Grand Total: ${formatCurrency(invoice.total)}`,
      pageWidth - 14,
      finalY + 10,
      { align: 'right' }
    );

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.setFont('helvetica', 'normal');
    doc.text('Thank you for your business!', 14, doc.internal.pageSize.height - 10);

    return doc;
  };

  const generatePDF = (invoice: Invoice) => {
    const doc = createInvoicePDF(invoice, { includeStatus: true });
    doc.save(`Invoice_${invoice.invoiceNumber}.pdf`);
  };

  const printInvoice = (invoice: Invoice) => {
    // Print a clean, invoice-only PDF (no modal UI), and omit draft/status line.
    const doc = createInvoicePDF(invoice, { includeStatus: false });
    (doc as any).autoPrint?.();

    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);

    // Open in a new tab so the user can print from the PDF viewer.
    const win = window.open(url, '_blank', 'noopener,noreferrer');

    if (!win) {
      // Fallback: if popup was blocked, download so user can print manually.
      doc.save(`Invoice_${invoice.invoiceNumber}.pdf`);
      URL.revokeObjectURL(url);
      return;
    }

    setTimeout(() => URL.revokeObjectURL(url), 15000);
  };

  const getStatusIcon = (status: InvoiceStatus) => {
    switch (status) {
      case 'paid': return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      default: return <Clock className="w-4 h-4 text-amber-500" />;
    }
  };

  const filteredInvoices = invoices.filter(inv => 
    filterStatus === 'all' ? true : inv.status === filterStatus
  );

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
                         p.category.toLowerCase().includes(productSearch.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
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
          <h1 className="text-2xl font-bold text-zinc-900">Invoices</h1>
          <p className="text-zinc-500">Generate and track customer billing.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-white border border-zinc-200 rounded-xl p-1 shadow-sm">
            <button
              onClick={() => setFilterStatus('all')}
              className={cn(
                "px-3 py-1.5 text-xs font-bold rounded-lg transition-all",
                filterStatus === 'all' ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-50"
              )}
            >
              All
            </button>
            <button
              onClick={() => setFilterStatus('draft')}
              className={cn(
                "px-3 py-1.5 text-xs font-bold rounded-lg transition-all",
                filterStatus === 'draft' ? "bg-amber-500 text-white" : "text-zinc-500 hover:bg-zinc-50"
              )}
            >
              Pending
            </button>
            <button
              onClick={() => setFilterStatus('paid')}
              className={cn(
                "px-3 py-1.5 text-xs font-bold rounded-lg transition-all",
                filterStatus === 'paid' ? "bg-emerald-500 text-white" : "text-zinc-500 hover:bg-zinc-50"
              )}
            >
              Paid
            </button>
          </div>
          {canEdit && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl hover:bg-zinc-800 transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" />
              New Invoice
            </button>
          )}
        </div>
      </div>

      {/* Invoices Table */}
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50/50 border-b border-zinc-100">
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Invoice #</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Customer</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Date</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Amount</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {filteredInvoices.map((invoice) => (
                <tr 
                  key={invoice.id}
                  className="hover:bg-zinc-50/50 transition-colors group cursor-pointer"
                  onClick={() => setViewingInvoice(invoice)}
                >
                  <td className="px-6 py-4">
                    <span className="text-sm font-bold text-zinc-900">#{invoice.invoiceNumber}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-zinc-900">{invoice.customerName}</span>
                      <span className="text-xs text-zinc-400">{invoice.customerEmail || 'No email'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-zinc-500">
                      {new Date(invoice.createdAt).toLocaleDateString()}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm font-black text-zinc-900">{formatCurrency(invoice.total)}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5">
                      {getStatusIcon(invoice.status)}
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-wider",
                        invoice.status === 'paid' ? "text-emerald-600" : "text-amber-600"
                      )}>
                        {invoice.status === 'draft' ? 'pending' : invoice.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => generatePDF(invoice)}
                        className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all"
                        title="Download PDF"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      {canEdit && (
                        <button
                          onClick={() => setInvoiceToDelete(invoice)}
                          className="p-2 text-zinc-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          title="Delete Invoice"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => setViewingInvoice(invoice)}
                        className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredInvoices.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-20 text-center">
                    <FileText className="w-12 h-12 text-zinc-100 mx-auto mb-4" />
                    <p className="text-zinc-400 font-medium">No invoices found.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmationModal
        isOpen={!!invoiceToDelete}
        onClose={() => setInvoiceToDelete(null)}
        onConfirm={handleDelete}
        title="Delete Invoice"
        message={`Are you sure you want to delete invoice #${invoiceToDelete?.invoiceNumber}? This action cannot be undone.`}
        confirmText="Delete"
        isLoading={deleteLoading}
        variant="danger"
      />

      {/* Create Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-xl">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="bg-white w-full max-w-7xl rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[94vh] border border-zinc-200"
            >
              {/* Modal Header */}
              <div className="px-6 py-4 md:px-8 md:py-6 border-b border-zinc-100 flex items-center justify-between bg-white sticky top-0 z-10">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-zinc-900 text-white flex items-center justify-center shrink-0">
                    <Plus className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="text-lg md:text-xl font-bold text-zinc-900">New Invoice</h3>
                      <span className="lg:hidden px-2 py-0.5 bg-zinc-100 rounded text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Step {currentStep} of 3</span>
                      <span className="hidden lg:inline-block px-2 py-0.5 bg-zinc-100 rounded text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Draft</span>
                    </div>
                    <p className="text-xs text-zinc-500 hidden sm:block">
                      <span className="lg:hidden">
                        {currentStep === 1 && "Enter customer details"}
                        {currentStep === 2 && "Select products from catalog"}
                        {currentStep === 3 && "Review and generate invoice"}
                      </span>
                      <span className="hidden lg:inline">Configure billing details and select inventory items</span>
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsModalOpen(false)} 
                  className="w-10 h-10 flex items-center justify-center hover:bg-zinc-100 rounded-lg transition-all text-zinc-400 hover:text-zinc-900"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Mobile Step Indicator */}
              <div className="lg:hidden px-6 py-3 bg-zinc-50 border-b border-zinc-100 flex items-center gap-2">
                {[1, 2, 3].map((s) => (
                  <div key={s} className="flex items-center gap-2 flex-1 max-w-[120px]">
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all",
                      currentStep === s ? "bg-zinc-900 text-white" : 
                      currentStep > s ? "bg-emerald-500 text-white" : "bg-zinc-200 text-zinc-500"
                    )}>
                      {currentStep > s ? "✓" : s}
                    </div>
                    <div className={cn(
                      "h-1 flex-1 rounded-full",
                      currentStep >= s ? "bg-zinc-900" : "bg-zinc-200"
                    )} />
                  </div>
                ))}
              </div>
              
              <div className="flex-1 overflow-y-auto flex flex-col lg:flex-row min-h-0">
                {/* Left: Product Selection (Catalog Sidebar) */}
                <div className={cn(
                  "w-full lg:w-[350px] xl:w-[400px] bg-zinc-50 p-4 md:p-6 lg:p-8 flex flex-col gap-6 border-b lg:border-b-0 lg:border-r border-zinc-100 shrink-0",
                  "lg:flex", // Always flex on desktop
                  currentStep === 2 ? "flex" : "hidden" // Only flex on mobile if step 2
                )}>
                  <div className="space-y-1">
                    <h3 className="text-lg font-bold text-zinc-900">Product Catalog</h3>
                    <p className="text-xs text-zinc-500">Select items to add to invoice</p>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="relative">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                      <input
                        type="text"
                        placeholder="Search inventory..."
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        className="w-full pl-11 pr-4 py-2.5 bg-white border border-zinc-200 rounded-lg focus:outline-none focus:border-zinc-900 transition-all text-sm placeholder:text-zinc-400"
                      />
                    </div>

                    {/* Category Chips */}
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                      {categories.map((cat) => (
                        <button
                          key={cat}
                          onClick={() => setSelectedCategory(cat)}
                          className={cn(
                            "px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all whitespace-nowrap border",
                            selectedCategory === cat 
                              ? "bg-zinc-900 text-white border-zinc-900" 
                              : "bg-white text-zinc-500 border-zinc-200 hover:border-zinc-400"
                          )}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar min-h-[300px] lg:min-h-0">
                    {filteredProducts.map((product, idx) => {
                      const isSelected = selectedItems.some(i => i.productId === product.id);
                      return (
                        <motion.button
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.03 }}
                          key={product.id}
                          onClick={() => addItem(product)}
                          className={cn(
                            "w-full flex items-center justify-between p-4 rounded-lg border transition-all text-left group",
                            isSelected ? "bg-zinc-900 border-zinc-900" : "bg-white border-zinc-200 hover:border-zinc-900"
                          )}
                        >
                          <div className="min-w-0">
                            <p className={cn("text-sm font-bold truncate", isSelected ? "text-white" : "text-zinc-900")}>{product.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={cn("text-[10px] font-medium uppercase tracking-wider", isSelected ? "text-zinc-400" : "text-zinc-500")}>{product.category}</span>
                              <span className={cn("w-1 h-1 rounded-full", isSelected ? "bg-zinc-700" : "bg-zinc-200")} />
                              <span className={cn("text-[10px]", isSelected ? "text-zinc-500" : "text-zinc-400")}>Stock: {product.stock}</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0 ml-3">
                            <p className={cn("text-sm font-bold", isSelected ? "text-white" : "text-zinc-900")}>{formatCurrency(product.price)}</p>
                            {isSelected ? (
                              <div className="flex items-center justify-end gap-1 text-[10px] font-bold text-emerald-400">
                                <CheckCircle2 className="w-3 h-3" /> ADDED
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-1 text-[10px] font-bold text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Plus className="w-3 h-3" /> ADD
                              </div>
                            )}
                          </div>
                        </motion.button>
                      );
                    })}
                    {filteredProducts.length === 0 && (
                      <div className="py-16 text-center">
                        <Search className="w-8 h-8 text-zinc-200 mx-auto mb-3" />
                        <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">No matches</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: Invoice Details & Summary */}
                <div className={cn(
                  "flex-1 overflow-y-auto p-4 md:p-8 lg:p-10 space-y-8 md:space-y-10 bg-white custom-scrollbar",
                  "lg:block", // Always block on desktop
                  (currentStep === 1 || currentStep === 3) ? "block" : "hidden" // Show on mobile if step 1 or 3
                )}>
                  {formError && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 bg-red-50 border border-red-100 rounded-lg text-red-600 text-sm flex items-center gap-3"
                    >
                      <AlertCircle className="w-5 h-5 shrink-0" />
                      <p className="font-medium">{formError}</p>
                    </motion.div>
                  )}
                  
                  {/* Customer Section */}
                  <div className={cn(
                    "space-y-6",
                    "lg:block", // Always show on desktop
                    currentStep === 1 ? "block" : "hidden" // Only show on mobile if step 1
                  )}>
                    <h3 className="text-lg font-bold text-zinc-900 border-b border-zinc-100 pb-2">Customer Details</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Full Name</label>
                        <input
                          placeholder="e.g. Alexander Pierce"
                          value={customerName}
                          onChange={(e) => setCustomerName(e.target.value)}
                          className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-lg focus:outline-none focus:border-zinc-900 transition-all text-sm font-medium placeholder:text-zinc-300"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Email Address</label>
                        <input
                          placeholder="alex@example.com"
                          type="email"
                          value={customerEmail}
                          onChange={(e) => setCustomerEmail(e.target.value)}
                          className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-lg focus:outline-none focus:border-zinc-900 transition-all text-sm font-medium placeholder:text-zinc-300"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Status</label>
                        <div className="relative">
                          <select
                            value={invoiceStatus}
                            onChange={(e) => setInvoiceStatus(e.target.value as InvoiceStatus)}
                            className="w-full px-4 py-2.5 bg-white border border-zinc-200 rounded-lg focus:outline-none focus:border-zinc-900 transition-all text-sm font-medium appearance-none cursor-pointer"
                          >
                            <option value="draft">Pending / Draft</option>
                            <option value="paid">Paid / Completed</option>
                          </select>
                          <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 rotate-90 pointer-events-none" />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Items Section */}
                  <div className={cn(
                    "space-y-6",
                    "lg:block", // Always show on desktop
                    currentStep === 3 ? "block" : "hidden" // Only show on mobile if step 3
                  )}>
                    <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                      <h3 className="text-lg font-bold text-zinc-900">Invoice Items</h3>
                      <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">{selectedItems.length} items</span>
                    </div>
                    
                    <div className="space-y-3">
                      <AnimatePresence mode="popLayout">
                        {selectedItems.map((item) => (
                          <motion.div 
                            layout
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 0.98 }}
                            key={item.productId} 
                            className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 p-4 sm:p-5 bg-white rounded-lg border border-zinc-200 hover:border-zinc-300 transition-all"
                          >
                            <div className="flex items-center gap-4 flex-1 min-w-0">
                              <div className="w-10 h-10 rounded-lg bg-zinc-50 flex items-center justify-center shrink-0">
                                <FileText className="w-5 h-5 text-zinc-400" />
                              </div>
                              
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-zinc-900 truncate">{item.productName}</p>
                                <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mt-0.5">{formatCurrency(item.price)} / unit</p>
                              </div>
                            </div>

                            <div className="flex items-center justify-between sm:justify-end gap-4 sm:gap-8 border-t sm:border-t-0 pt-3 sm:pt-0">
                              <div className="flex items-center border border-zinc-200 rounded-lg overflow-hidden bg-white">
                                <button 
                                  onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                                  className="w-8 h-8 flex items-center justify-center hover:bg-zinc-50 transition-all text-zinc-600 font-bold"
                                >
                                  -
                                </button>
                                <input
                                  type="number"
                                  value={item.quantity}
                                  onChange={(e) => updateQuantity(item.productId, parseInt(e.target.value) || 1)}
                                  className="w-10 bg-transparent text-center font-bold text-sm focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-zinc-900"
                                />
                                <button 
                                  onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                                  className="w-8 h-8 flex items-center justify-center hover:bg-zinc-50 transition-all text-zinc-600 font-bold"
                                >
                                  +
                                </button>
                              </div>
                              
                              <div className="min-w-[80px] sm:w-28 text-right">
                                <p className="text-sm font-bold text-zinc-900">{formatCurrency(item.total)}</p>
                              </div>

                              <button 
                                onClick={() => removeItem(item.productId)}
                                className="w-8 h-8 flex items-center justify-center text-zinc-300 hover:text-red-500 transition-all"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                      
                      {selectedItems.length === 0 && (
                        <div className="py-16 text-center bg-zinc-50/50 rounded-lg border border-dashed border-zinc-200">
                          <p className="text-sm font-medium text-zinc-400">No items added to invoice</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Footer / Total Section */}
                  {selectedItems.length > 0 && (
                    <div className={cn(
                      "pt-8 border-t border-zinc-100 flex flex-col sm:flex-row items-center justify-between gap-8",
                      "lg:flex", // Always flex on desktop
                      currentStep === 3 ? "flex" : "hidden" // Only flex on mobile if step 3
                    )}>
                      <div className="text-left">
                        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Total Amount</p>
                        <p className="text-5xl font-bold text-zinc-900 tracking-tight">{formatCurrency(total)}</p>
                      </div>
                      
                      <button
                        onClick={handleSubmit}
                        disabled={submitLoading || selectedItems.length === 0 || !customerName}
                        className="w-full sm:w-auto px-10 py-4 bg-zinc-900 text-white rounded-lg font-bold text-sm uppercase tracking-widest hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
                      >
                        {submitLoading ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <>
                            <CheckCircle2 className="w-5 h-5" />
                            <span>Generate Invoice</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Mobile Navigation Footer */}
              <div className="lg:hidden px-6 py-4 border-t border-zinc-100 bg-zinc-50 flex items-center justify-between sticky bottom-0 z-10">
                <button
                  onClick={() => setCurrentStep(prev => Math.max(1, prev - 1))}
                  disabled={currentStep === 1}
                  className="px-4 py-2 text-sm font-bold text-zinc-500 hover:text-zinc-900 disabled:opacity-0 transition-all"
                >
                  Back
                </button>
                
                <div className="flex items-center gap-3">
                  {currentStep < 3 ? (
                    <button
                      onClick={() => {
                        if (currentStep === 1 && !customerName) {
                          setFormError('Please enter a customer name');
                          return;
                        }
                        if (currentStep === 2 && selectedItems.length === 0) {
                          setFormError('Please select at least one item');
                          return;
                        }
                        setFormError('');
                        setCurrentStep(prev => prev + 1);
                      }}
                      className="px-6 py-2.5 bg-zinc-900 text-white rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-zinc-800 transition-all flex items-center gap-2"
                    >
                      Next Step
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={handleSubmit}
                      disabled={submitLoading || selectedItems.length === 0 || !customerName}
                      className="px-8 py-2.5 bg-emerald-500 text-white rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                    >
                      {submitLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Submit</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* View Modal */}
      {viewingInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-4xl rounded-2xl md:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh] md:max-h-[90vh] animate-in fade-in zoom-in duration-200 invoice-print-root">
            <div className="px-4 md:px-8 py-4 md:py-5 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
              <div className="flex items-center gap-3 md:gap-4">
                <div>
                  <h3 className="text-lg md:text-xl font-bold text-zinc-900">Invoice Details</h3>
                  <p className="text-[10px] md:text-xs text-zinc-500 font-medium">#{viewingInvoice.invoiceNumber}</p>
                </div>
                <div className="flex items-center gap-1.5 px-2 md:px-3 py-0.5 md:py-1 bg-white rounded-full border border-zinc-200 shadow-sm no-print">
                  {getStatusIcon(viewingInvoice.status)}
                  <span className="text-[9px] md:text-[10px] font-bold text-zinc-600 uppercase tracking-wider">
                    {viewingInvoice.status}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 md:gap-2 no-print">
                <button 
                  onClick={() => printInvoice(viewingInvoice)}
                  className="p-2 md:p-2.5 hover:bg-white rounded-xl border border-transparent hover:border-zinc-200 transition-all text-zinc-600"
                >
                  <Printer className="w-4 md:w-5 h-4 md:h-5" />
                </button>
                <button onClick={() => setViewingInvoice(null)} className="p-2 md:p-2.5 hover:bg-white rounded-xl border border-transparent hover:border-zinc-200 transition-all text-zinc-400">
                  <X className="w-4 md:w-5 h-4 md:h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 md:p-8 lg:p-10 space-y-8 md:space-y-12 bg-white">
              {/* Header */}
              <div className="flex flex-col md:flex-row justify-between items-start gap-6 md:gap-8">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 md:w-10 md:h-10 bg-zinc-900 rounded-lg md:rounded-xl flex items-center justify-center">
                      <FileText className="w-5 h-5 md:w-6 md:h-6 text-white" />
                    </div>
                    <h2 className="text-2xl md:text-3xl font-black text-zinc-900 tracking-tighter">ProCRM</h2>
                  </div>
                  <p className="text-xs md:text-sm text-zinc-400 font-medium leading-relaxed">
                    123 Business Avenue, Suite 100<br />
                    New York, NY 10001<br />
                    contact@procrm.com
                  </p>
                </div>
                <div className="text-left md:text-right space-y-1 w-full md:w-auto">
                  <p className="text-[10px] font-black text-zinc-300 uppercase tracking-[0.2em] mb-2">Bill To</p>
                  <p className="text-xl md:text-2xl font-black text-zinc-900">{viewingInvoice.customerName}</p>
                  <p className="text-xs md:text-sm font-medium text-zinc-500">{viewingInvoice.customerEmail || 'No email provided'}</p>
                  <div className="pt-4">
                    <p className="text-[10px] font-black text-zinc-300 uppercase tracking-[0.2em]">Date Issued</p>
                    <p className="text-xs md:text-sm font-bold text-zinc-900">{new Date(viewingInvoice.createdAt).toLocaleDateString('en-US', { dateStyle: 'long' })}</p>
                  </div>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto rounded-xl md:rounded-2xl border border-zinc-100 shadow-sm">
                <table className="w-full text-left border-collapse min-w-[500px]">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-100">
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Item Description</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-center w-24">Qty</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right w-32">Price</th>
                      <th className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase tracking-widest text-right w-32">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {viewingInvoice.items.map((item, i) => (
                      <tr key={i} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="px-6 py-5 text-sm font-bold text-zinc-900">{item.productName}</td>
                        <td className="px-6 py-5 text-sm text-zinc-500 text-center font-medium">{item.quantity}</td>
                        <td className="px-6 py-5 text-sm text-zinc-500 text-right font-medium">{formatCurrency(item.price)}</td>
                        <td className="px-6 py-5 text-sm font-black text-zinc-900 text-right">{formatCurrency(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary */}
              <div className="flex flex-col md:flex-row justify-between items-end gap-8 pt-4">
                <div className="flex-1 max-w-md">
                  <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Notes</p>
                  <p className="text-xs text-zinc-500 leading-relaxed italic">
                    Thank you for your business. For any queries, please contact our support team.
                  </p>
                </div>
                <div className="w-full md:w-80 space-y-4">
                  <div className="p-8 bg-zinc-900 rounded-[2.5rem] text-white shadow-2xl shadow-zinc-900/20 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-3xl" />
                    <div className="relative z-10">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Amount Due</span>
                        <div className="h-px flex-1 mx-4 bg-white/10" />
                      </div>
                      <div className="flex justify-between items-baseline">
                        <span className="text-4xl font-black tracking-tighter">{formatCurrency(viewingInvoice.total)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            {canEdit && (
              <div className="p-4 md:p-8 bg-zinc-50 border-t border-zinc-100 flex flex-col sm:flex-row gap-3 md:gap-4 no-print">
                {viewingInvoice.status === 'draft' && (
                  <button 
                    onClick={() => updateStatus(viewingInvoice.id, 'paid')}
                    disabled={!!statusLoading}
                    className="flex-1 py-3 md:py-4 bg-emerald-500 text-white rounded-xl md:rounded-2xl font-black text-[10px] md:text-xs uppercase tracking-widest hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 md:gap-3 shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                  >
                    {statusLoading === viewingInvoice.id ? <Loader2 className="w-4 md:w-5 h-4 md:h-5 animate-spin" /> : <CheckCircle2 className="w-4 md:w-5 h-4 md:h-5" />}
                    Mark as Paid
                  </button>
                )}
                {viewingInvoice.status === 'paid' && (
                  <button 
                    onClick={() => updateStatus(viewingInvoice.id, 'draft')}
                    disabled={!!statusLoading}
                    className="flex-1 py-3 md:py-4 bg-amber-500 text-white rounded-xl md:rounded-2xl font-black text-[10px] md:text-xs uppercase tracking-widest hover:bg-amber-600 transition-all flex items-center justify-center gap-2 md:gap-3 shadow-lg shadow-amber-500/20 disabled:opacity-50"
                  >
                    {statusLoading === viewingInvoice.id ? <Loader2 className="w-4 md:w-5 h-4 md:h-5 animate-spin" /> : <Clock className="w-4 md:w-5 h-4 md:h-5" />}
                    Mark as Pending
                  </button>
                )}
                <button 
                  onClick={() => generatePDF(viewingInvoice)}
                  className="py-3 md:py-4 px-6 md:px-8 bg-zinc-900 text-white rounded-xl md:rounded-2xl font-black text-[10px] md:text-xs uppercase tracking-widest hover:bg-zinc-800 transition-all flex items-center justify-center gap-2 md:gap-3 shadow-lg shadow-zinc-900/10"
                >
                  <Download className="w-4 md:w-5 h-4 md:h-5" />
                  Download PDF
                </button>
                <button 
                  onClick={() => setInvoiceToDelete(viewingInvoice)}
                  className="py-3 md:py-4 px-6 md:px-8 bg-white border-2 border-red-100 text-red-600 rounded-xl md:rounded-2xl font-black text-[10px] md:text-xs uppercase tracking-widest hover:bg-red-50 transition-all flex items-center justify-center gap-2 md:gap-3"
                >
                  <Trash2 className="w-4 md:w-5 h-4 md:h-5" />
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

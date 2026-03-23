import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Invoice, Product } from '../types';
import { formatCurrency, cn } from '../lib/utils';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import { 
  TrendingUp, 
  Users, 
  Package, 
  FileText,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';

export function Dashboard() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const { data: invoicesData } = await supabase
        .from('invoices')
        .select('*')
        .order('createdAt', { ascending: false });
      
      if (invoicesData) setInvoices(invoicesData as Invoice[]);

      const { data: productsData } = await supabase
        .from('products')
        .select('*')
        .limit(100);
      
      if (productsData) setProducts(productsData as Product[]);
      setLoading(false);
    };

    fetchData();

    // Set up subscriptions for real-time updates
    const invoicesSubscription = supabase
      .channel('invoices-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setInvoices(prev => [payload.new as Invoice, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setInvoices(prev => prev.map(inv => inv.id === payload.new.id ? payload.new as Invoice : inv));
        } else if (payload.eventType === 'DELETE') {
          setInvoices(prev => prev.filter(inv => inv.id !== payload.old.id));
        }
      })
      .subscribe();

    const productsSubscription = supabase
      .channel('products-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setProducts(prev => [...prev, payload.new as Product].slice(0, 100));
        } else if (payload.eventType === 'UPDATE') {
          setProducts(prev => prev.map(prod => prod.id === payload.new.id ? payload.new as Product : prod));
        } else if (payload.eventType === 'DELETE') {
          setProducts(prev => prev.filter(prod => prod.id !== payload.old.id));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(invoicesSubscription);
      supabase.removeChannel(productsSubscription);
    };
  }, []);

  const totalRevenue = invoices
    .filter(inv => inv.status === 'paid')
    .reduce((sum, inv) => sum + inv.total, 0);

  const pendingInvoices = invoices.filter(inv => inv.status === 'draft');
  const pendingCount = pendingInvoices.length;
  const pendingRevenue = pendingInvoices.reduce((sum, inv) => sum + inv.total, 0);

  const stats = [
    { 
      label: 'Total Revenue', 
      value: formatCurrency(totalRevenue), 
      icon: TrendingUp, 
      color: 'text-emerald-600', 
      bg: 'bg-emerald-50',
      trend: '+12.5%',
      trendUp: true
    },
    { 
      label: 'Pending Invoices', 
      value: pendingCount.toString(), 
      icon: FileText, 
      color: 'text-amber-600', 
      bg: 'bg-amber-50',
      trend: '-2.4%',
      trendUp: false
    },
    { 
      label: 'Pending Amount', 
      value: formatCurrency(pendingRevenue), 
      icon: FileText, 
      color: 'text-orange-600', 
      bg: 'bg-orange-50',
      trend: 'Due',
      trendUp: false
    },
    { 
      label: 'Active Products', 
      value: products.length.toString(), 
      icon: Package, 
      color: 'text-blue-600', 
      bg: 'bg-blue-50',
      trend: '+4',
      trendUp: true
    },
  ];

  const chartData = invoices
    .slice(0, 7)
    .reverse()
    .map(inv => ({
      name: inv.invoiceNumber,
      total: inv.total,
      status: inv.status
    }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Dashboard Overview</h1>
        <p className="text-zinc-500">Welcome back! Here's what's happening today.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <div key={i} className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className={stat.bg + " p-2 rounded-lg"}>
                <stat.icon className={"w-5 h-5 " + stat.color} />
              </div>
              <div className={stat.trendUp ? "text-emerald-600" : "text-red-600" + " flex items-center text-xs font-medium"}>
                {stat.trend}
                {stat.trendUp ? <ArrowUpRight className="w-3 h-3 ml-0.5" /> : <ArrowDownRight className="w-3 h-3 ml-0.5" />}
              </div>
            </div>
            <p className="text-sm text-zinc-500 font-medium">{stat.label}</p>
            <p className="text-2xl font-bold text-zinc-900 mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Chart */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
          <h3 className="text-lg font-semibold text-zinc-900 mb-6">Recent Invoices Performance</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#71717a', fontSize: 12 }}
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#71717a', fontSize: 12 }}
                  tickFormatter={(val) => `Rs ${val}`}
                />
                <Tooltip 
                  cursor={{ fill: '#f4f4f5' }}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                />
                <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={entry.status === 'paid' ? '#10b981' : '#f59e0b'} 
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
          <h3 className="text-lg font-semibold text-zinc-900 mb-6">Recent Activity</h3>
          <div className="space-y-6">
            {invoices.slice(0, 5).map((inv) => (
              <div key={inv.id} className="flex items-center gap-4">
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  inv.status === 'paid' ? "bg-emerald-500" : 
                  inv.status === 'draft' ? "bg-amber-500" : "bg-zinc-300"
                )} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-900 truncate">
                    Invoice {inv.invoiceNumber}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {inv.customerName} • {formatCurrency(inv.total)}
                  </p>
                </div>
                <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">
                  {inv.status}
                </span>
              </div>
            ))}
            {invoices.length === 0 && (
              <p className="text-sm text-zinc-500 text-center py-8">No recent activity</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

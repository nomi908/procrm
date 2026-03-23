import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export async function safeFetch(url: string, options?: RequestInit) {
  try {
    const response = await fetch(url, options);
    return response;
  } catch (error: any) {
    if (error.message === 'Failed to fetch') {
      throw new Error('Network error: Could not reach the server. Please ensure the backend is running and you have a stable internet connection.');
    }
    throw error;
  }
}

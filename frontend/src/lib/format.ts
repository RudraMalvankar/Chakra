export const formatCurrency = (val: number | undefined | null) => {
  if (val === undefined || val === null) return "₹0";
  if (val >= 1000000) return `₹${(val / 1000000).toFixed(2)}M`;
  if (val >= 1000) return `₹${(val / 1000).toFixed(1)}K`;
  return `₹${val.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

export const formatExact = (val: number | undefined | null) => 
  `₹${(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const formatPercent = (val: number | undefined | null) => {
  if (val === undefined || val === null) return "0%";
  return `${val.toFixed(2)}%`;
};

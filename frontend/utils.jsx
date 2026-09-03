const formatCurrency = (val) => {
    if (val === undefined || val === null) return "₹0";
    if (val >= 1000000) return `₹${(val / 1000000).toFixed(2)}M`;
    if (val >= 1000) return `₹${(val / 1000).toFixed(1)}K`;
    return `₹${val.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

const formatExact = (val) => `₹${(val||0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatPercent = (val) => {
    if (val === undefined || val === null) return "0%";
    return `${val.toFixed(2)}%`;
};

const Icon = ({ name, size = 20, className = "" }) => {
    const iconHtml = lucide.icons[name]?.toSvg({ width: size, height: size, class: className }) || '';
    return <span dangerouslySetInnerHTML={{ __html: iconHtml }} className={`inline-flex items-center justify-center ${className}`} />;
};

const Badge = ({ children, status, className="" }) => {
    let colors = "bg-gray-100 text-gray-700 border-gray-200";
    if (status === 'SUCCESS' || status === 'RECOVERED' || status === 'APPROVED' || status === 'ALLOWED') colors = "bg-rzp-greenLight text-green-700 border-green-200";
    if (status === 'WARNING' || status === 'PENDING' || status === 'MEDIUM' || status === 'RECOVERY_PENDING') colors = "bg-yellow-50 text-yellow-700 border-yellow-200";
    if (status === 'DANGER' || status === 'BLOCKED' || status === 'FAILED' || status === 'HIGH') colors = "bg-rzp-redLight text-red-700 border-red-200";
    if (status === 'INFO' || status === 'ESCALATED' || status === 'LOW') colors = "bg-blue-50 text-rzp-blue border-blue-200";
    
    return (
        <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${colors} flex items-center w-fit ${className}`}>
            {children}
        </span>
    );
};

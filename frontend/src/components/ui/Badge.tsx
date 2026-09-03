import React from 'react';

export const Badge: React.FC<{ children: React.ReactNode, status?: string, className?: string }> = ({ children, status, className="" }) => {
    let colors = "bg-gray-100 text-gray-700 border-gray-200";
    if (status === 'SUCCESS' || status === 'RECOVERED' || status === 'APPROVED' || status === 'ALLOWED' || status === 'captured') colors = "bg-rzp-greenLight text-green-700 border-green-200";
    if (status === 'WARNING' || status === 'PENDING' || status === 'MEDIUM' || status === 'RECOVERY_PENDING') colors = "bg-yellow-50 text-yellow-700 border-yellow-200";
    if (status === 'DANGER' || status === 'BLOCKED' || status === 'FAILED' || status === 'HIGH' || status === 'failed') colors = "bg-rzp-redLight text-red-700 border-red-200";
    if (status === 'INFO' || status === 'ESCALATED' || status === 'LOW') colors = "bg-blue-50 text-rzp-blue border-blue-200";
    
    return (
        <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold border ${colors} flex items-center w-fit ${className}`}>
            {children}
        </span>
    );
};

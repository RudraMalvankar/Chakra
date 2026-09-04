import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export const PromiseToPay = () => {
    const navigate = useNavigate();
    useEffect(() => {
        // Redirect to integrated Receivables view per requirements
        navigate('/receivables', { replace: true });
    }, [navigate]);
    return null;
};

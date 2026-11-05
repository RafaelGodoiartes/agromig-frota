import React from 'react';
import ReactDOM from 'react-dom/client';
import BillingMeasurementsView from '@/components/BillingMeasurementsView';
import FleetOverviewPortal from '@/components/FleetOverviewPortal';
import '@/index.css';

ReactDOM.createRoot(document.getElementById('root')).render(window.FLEET_OVERVIEW ? <FleetOverviewPortal /> : <BillingMeasurementsView />);

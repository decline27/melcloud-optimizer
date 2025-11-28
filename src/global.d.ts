// Global type declarations for the MELCloud Optimizer app
// These globals are used by api.ts for service management and cleanup

import { COPHelper } from './services/cop-helper';
import { MelCloudApi } from './services/melcloud-api';
import { Optimizer } from './services/optimizer';
import { PriceProvider } from './types';

declare global {
  // Used by api.ts for COP data access and cleanup
  var copHelper: COPHelper | null;
  // Used by service-manager.ts and api.ts for MELCloud API access
  var melCloud: MelCloudApi | null;
  // Used by service-manager.ts and api.ts for price provider access  
  var tibber: PriceProvider | null;
  // Used by api.ts for optimizer access and cleanup
  var optimizer: Optimizer | null;
}

export {};

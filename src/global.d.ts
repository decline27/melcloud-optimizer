// Global type declarations for the MELCloud Optimizer app

import { COPHelper } from './services/cop-helper';
import { MelCloudApi } from './services/melcloud-api';
import { Optimizer } from './services/optimizer';
import { IHeatpumpProvider } from './providers/types';
import { PriceProvider } from './types';

declare global {
  var copHelper: COPHelper | null;
  var melCloud: MelCloudApi | null;
  var heatpumpProvider: IHeatpumpProvider | null;
  var tibber: PriceProvider | null;
  var optimizer: Optimizer | null;
}

export {};

// Global type declarations for the MELCloud Optimizer app

import { COPHelper } from './services/cop-helper';
import { MelCloudApi } from './services/melcloud-api';
import { TibberApi } from './services/tibber-api';
import { Optimizer } from './services/optimizer';

declare global {
  var copHelper: COPHelper | null;
  var melCloud: MelCloudApi | null;
  var tibber: TibberApi | null;
  var optimizer: Optimizer | null;
}

export {};

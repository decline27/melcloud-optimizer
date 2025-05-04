// Global type declarations for the MELCloud Optimizer app

import { COPHelper } from './services/cop-helper';

declare global {
  var copHelper: COPHelper;
  var melCloud: any; // MELCloud API instance
}

export {};

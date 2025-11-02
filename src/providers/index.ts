import { Vendor, IHeatpumpProvider } from './types';
import { MELCloudProvider } from './melcloud-provider';
import { MyUplinkProvider } from './myuplink-provider';
import { getSettings } from '../ui/settings/settings-schema';

export function createProvider(): IHeatpumpProvider {
  const settings = getSettings();
  const vendor = (settings.vendor as Vendor) || 'melcloud';

  switch (vendor) {
    case 'melcloud':
      return new MELCloudProvider(settings.melcloud);
    case 'myuplink':
      return new MyUplinkProvider(settings.myUplink);
    default:
      throw new Error(`Unsupported vendor: ${vendor}`);
  }
}

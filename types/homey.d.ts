declare module 'homey' {
  export class App {
    homey: {
      settings: {
        get(key: string): any;
        set(key: string, value: any): void;
        unset(key: string): Promise<void>;
        on(event: string, callback: (key: string) => void): void;
      };
      notifications: {
        createNotification(notification: { excerpt: string }): Promise<void>;
      };
      timeline?: {
        createEntry(entry: any): Promise<void>;
      };
      flow?: {
        runFlowCardAction(action: any): Promise<void>;
      };
      version?: string;
      platform?: string;
      id?: string;
      manifest?: { version: string };
    };
    log(message: string, ...args: any[]): void;
    error(message: string, error?: Error): void;
    id?: string;
    manifest?: { version: string };
  }
  
  export class Device {
    homey: App['homey'];
    getName(): string;
    getStoreValue(key: string): any;
    getSetting(key: string): any;
    setUnavailable(message: string): Promise<void>;
    setAvailable(): Promise<void>;
    setWarning(message: string): Promise<void>;
    hasCapability(capability: string): boolean;
    addCapability(capability: string): Promise<void>;
    removeCapability(capability: string): Promise<void>;
    setCapabilityValue(capability: string, value: any): Promise<void>;
    getCapabilityValue(capability: string): any;
    getAvailable(): boolean;
    registerCapabilityListener(capability: string, callback: (value: any) => void): void;
  }
  
  export class Driver {
    homey: App['homey'];
  }
}

declare module 'timeline-helper-wrapper' {
  export class TimelineHelper {
    constructor(homey: any, logger?: any);
    addTimelineEntry(eventType: string, details?: any, createNotification?: boolean, additionalData?: any): Promise<void>;
  }
}

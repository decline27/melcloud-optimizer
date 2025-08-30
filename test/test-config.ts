import * as fs from 'fs';
import * as path from 'path';

export interface TestConfig {
  melcloud: {
    email: string;
    password: string;
  };
  tibber: {
    token: string;
  };
  test: {
    skipIntegration: boolean;
    timeout: number;
  };
}

/**
 * Load test configuration from config.json
 * Falls back to example values if config file doesn't exist
 */
export function loadTestConfig(): TestConfig {
  const configPath = path.join(__dirname, 'config.json');
  const exampleConfigPath = path.join(__dirname, 'config.example.json');
  
  try {
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);
      
      // Merge with defaults
      return {
        test: {
          skipIntegration: false,
          timeout: 30000
        },
        ...config
      };
    } else {
      console.warn('⚠️  test/config.json not found. Copy test/config.example.json to test/config.json and add your credentials for integration tests.');
      
      // Return safe defaults for unit tests
      return {
        melcloud: {
          email: 'test@example.com',
          password: 'test-password'
        },
        tibber: {
          token: 'test-token'
        },
        test: {
          skipIntegration: true,
          timeout: 30000
        }
      };
    }
  } catch (error) {
    console.error('Error loading test config, falling back to unit defaults:', error);
    // Return safe defaults that force integration tests to skip
    return {
      melcloud: {
        email: 'test@example.com',
        password: 'test-password'
      },
      tibber: {
        token: 'test-token'
      },
      test: {
        skipIntegration: true,
        timeout: 30000
      }
    };
  }
}

/**
 * Check if integration tests should be skipped
 */
export function shouldSkipIntegrationTests(): boolean {
  const config = loadTestConfig();
  return config.test.skipIntegration || 
         config.melcloud.email === 'test@example.com' ||
         config.tibber.token === 'test-token';
}

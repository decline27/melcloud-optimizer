import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';

interface ScenarioRow {
  ts: string;
  price: number | null;
  outdoor: number;
  indoorTempStart?: number;
  occupied: boolean;
  weatherTrend?: number;
  indoor?: number;
  events?: string[];
  thermalResponse?: number;
}

type ScenarioBuilder = () => ScenarioRow[];

const OUTPUT_DIR = path.resolve(__dirname);
const ZONE = 'Europe/Stockholm';
const HOURS = 48;

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function baseTimeline(options: {
  startISO: string;
  basePrice?: number;
  baseOutdoor?: number;
  indoorStart?: number;
  occupancy?: (dt: DateTime) => boolean;
}): ScenarioRow[] {
  const {
    startISO,
    basePrice = 0.45,
    baseOutdoor = 4,
    indoorStart = 20,
    occupancy
  } = options;
  const start = DateTime.fromISO(startISO, { zone: ZONE });
  const rows: ScenarioRow[] = [];
  for (let i = 0; i < HOURS; i += 1) {
    const dt = start.plus({ hours: i });
    const iso = dt.toISO();
    if (!iso) {
      throw new Error(`Failed to produce ISO timestamp for ${dt.toString()}`);
    }
    rows.push({
      ts: iso,
      price: basePrice,
      outdoor: baseOutdoor,
      occupied: occupancy ? occupancy(dt) : dt.hour >= 6 && dt.hour < 22
    });
  }
  rows[0].indoorTempStart = indoorStart;
  return rows;
}

function mapRows(rows: ScenarioRow[], transform: (row: ScenarioRow, index: number) => void) {
  rows.forEach((row, index) => transform(row, index));
  return rows;
}

const scenarios: Record<string, ScenarioBuilder> = {
  cold_front_cheap_night: () => {
    const rows = baseTimeline({
      startISO: '2025-01-10T00:00:00',
      basePrice: 0.48,
      baseOutdoor: -3,
      indoorStart: 20.2
    });
    return mapRows(rows, (row, idx) => {
      const hour = DateTime.fromISO(row.ts).setZone(ZONE).hour;
      if (hour >= 0 && hour <= 5) {
        row.price = 0.08 + 0.01 * (hour / 5);
      } else if (hour >= 17 && hour <= 21) {
        row.price = 0.75 + 0.05 * (hour - 17);
      } else {
        row.price = 0.42 + 0.01 * Math.sin(idx / 6);
      }
      row.outdoor = -3 - idx * 0.25;
      row.weatherTrend = -0.5;
    });
  },

  warm_spike_expensive_evening: () => {
    const rows = baseTimeline({
      startISO: '2025-07-01T00:00:00',
      basePrice: 0.35,
      baseOutdoor: 21,
      indoorStart: 23,
      occupancy: (dt) => dt.hour >= 8 && dt.hour <= 22
    });
    return mapRows(rows, (row, idx) => {
      const dt = DateTime.fromISO(row.ts).setZone(ZONE);
      const hour = dt.hour;
      const dayPhase = Math.sin((idx % 24) / 24 * Math.PI);
      row.outdoor = 20 + 6 * Math.max(0, dayPhase) + (idx > 24 ? 2 : 0);
      if (hour >= 17 && hour <= 20) {
        row.price = 0.85 + 0.05 * (hour - 17);
      } else if (hour >= 11 && hour <= 14) {
        row.price = 0.55;
      } else {
        row.price = 0.30 + 0.02 * Math.sin(idx / 3);
      }
      row.weatherTrend = hour >= 12 && hour <= 18 ? 0.1 : -0.05;
    });
  },

  sawtooth_prices_calm_weather: () => {
    const rows = baseTimeline({
      startISO: '2025-04-05T00:00:00',
      basePrice: 0.4,
      baseOutdoor: 10,
      indoorStart: 21,
      occupancy: () => true
    });
    return mapRows(rows, (_, idx) => {
      const row = rows[idx];
      row.price = idx % 2 === 0 ? 0.22 : 0.72;
      row.outdoor = 10 + 0.5 * Math.sin(idx / 6);
      row.weatherTrend = 0;
    });
  },

  price_outage_midday: () => {
    const rows = baseTimeline({
      startISO: '2025-02-18T00:00:00',
      basePrice: 0.46,
      baseOutdoor: 1,
      indoorStart: 20.5
    });
    return mapRows(rows, (row) => {
      const dt = DateTime.fromISO(row.ts).setZone(ZONE);
      const hour = dt.hour;
      if (hour >= 10 && hour <= 14) {
        row.price = null;
        row.events = ['price_outage'];
      } else if (hour >= 5 && hour <= 7) {
        row.price = 0.28;
      } else if (hour >= 17 && hour <= 22) {
        row.price = 0.68;
      } else {
        row.price = 0.42;
      }
      row.outdoor = 1 + 0.1 * Math.sin(hour / 2);
      row.weatherTrend = 0.05 * Math.cos(hour / 3);
    });
  },

  dst_transition_sunday: () => {
    const rows = baseTimeline({
      startISO: '2025-03-29T00:00:00',
      basePrice: 0.43,
      baseOutdoor: 6,
      indoorStart: 20.5,
      occupancy: (dt) => dt.hour >= 7 && dt.hour <= 23
    });
    return mapRows(rows, (row, idx) => {
      const dt = DateTime.fromISO(row.ts).setZone(ZONE);
      const hour = dt.hour;
      row.price = 0.35 + 0.03 * Math.sin(idx / 3);
      if (dt.weekday === 7 && hour >= 18 && hour <= 22) {
        row.price += 0.25;
      }
      row.outdoor = 6 + 2 * Math.sin(idx / 8);
      row.weatherTrend = idx < 24 ? -0.05 : 0.12;
    });
  },

  melcloud_rate_limit_burst: () => {
    const rows = baseTimeline({
      startISO: '2025-11-20T00:00:00',
      basePrice: 0.5,
      baseOutdoor: 2,
      indoorStart: 20.8
    });
    return mapRows(rows, (row, idx) => {
      const hour = DateTime.fromISO(row.ts).setZone(ZONE).hour;
      if (idx === 6) {
        row.events = ['melcloud_429'];
      }
      if (hour >= 6 && hour <= 8) {
        row.price = 0.35;
      } else if (hour >= 16 && hour <= 19) {
        row.price = 0.82;
      } else {
        row.price = 0.48 + 0.02 * Math.sin(idx / 5);
      }
      row.outdoor = 2 - 0.15 * idx + 0.8 * Math.sin(idx / 4);
      row.weatherTrend = -0.2;
    });
  },

  high_mass_house_cold: () => {
    const rows = baseTimeline({
      startISO: '2025-01-05T00:00:00',
      basePrice: 0.44,
      baseOutdoor: -12,
      indoorStart: 20.0
    });
    rows[0].thermalResponse = 1.35;
    return mapRows(rows, (row, idx) => {
      const hour = DateTime.fromISO(row.ts).setZone(ZONE).hour;
      if (hour >= 0 && hour <= 5) {
        row.price = 0.25;
      } else if (hour >= 17 && hour <= 21) {
        row.price = 0.78;
      } else {
        row.price = 0.5;
      }
      row.outdoor = -12 - idx * 0.18;
      row.weatherTrend = -0.3;
    });
  },

  low_mass_house_windy: () => {
    const rows = baseTimeline({
      startISO: '2025-02-12T00:00:00',
      basePrice: 0.47,
      baseOutdoor: 3,
      indoorStart: 21.2
    });
    rows[0].thermalResponse = 0.6;
    return mapRows(rows, (row, idx) => {
      const hour = DateTime.fromISO(row.ts).setZone(ZONE).hour;
      row.price = hour % 6 < 3 ? 0.38 : 0.7;
      row.outdoor = 3 + 1.5 * Math.sin(idx / 4) - 0.5 * Math.cos(idx / 2);
      row.weatherTrend = -0.1 + 0.2 * Math.sin(idx / 6);
      if (idx % 12 === 0) {
        row.events = ['windy'];
      }
    });
  }
};

function writeScenario(name: string, rows: ScenarioRow[]) {
  const filePath = path.join(OUTPUT_DIR, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2));
  return filePath;
}

async function main() {
  ensureDir(OUTPUT_DIR);
  const created: string[] = [];

  for (const [name, builder] of Object.entries(scenarios)) {
    const rows = builder();
    if (!Array.isArray(rows) || rows.length !== HOURS) {
      throw new Error(`Scenario ${name} did not produce ${HOURS} rows (got ${rows.length})`);
    }
    created.push(writeScenario(name, rows));
  }

  console.log('Generated scenario fixtures:');
  created.forEach((file) => console.log(`  - ${path.relative(process.cwd(), file)}`));
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Scenario generation failed:', error);
    process.exitCode = 1;
  });
}

export { scenarios, ScenarioRow };

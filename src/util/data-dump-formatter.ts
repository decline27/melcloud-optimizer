/**
 * HTML formatting utilities for data dump display
 */

export interface DataSection {
  title: string;
  content: string;
  hasData: boolean;
  errorMessage?: string;
}

/**
 * Format a timestamp for display
 */
export function formatTimestamp(timestamp: string | number | Date): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString();
  } catch {
    return String(timestamp);
  }
}

/**
 * Format a number with appropriate precision
 */
export function formatNumber(value: number, decimals = 2): string {
  if (typeof value !== 'number' || isNaN(value)) {
    return 'N/A';
  }
  return value.toFixed(decimals);
}

/**
 * Format bytes to human readable format
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Create an HTML table from array of objects
 */
export function createTable(data: any[], headers?: string[]): string {
  if (!Array.isArray(data) || data.length === 0) {
    return '<p class="no-data">No data available</p>';
  }

  // If headers not provided, use keys from first object
  if (!headers && data[0] && typeof data[0] === 'object') {
    headers = Object.keys(data[0]);
  }

  if (!headers || headers.length === 0) {
    return '<p class="no-data">No valid data structure</p>';
  }

  let html = '<table class="data-table">';
  
  // Header row
  html += '<thead><tr>';
  headers.forEach(header => {
    html += `<th>${escapeHtml(header)}</th>`;
  });
  html += '</tr></thead>';

  // Data rows
  html += '<tbody>';
  data.forEach(row => {
    html += '<tr>';
    headers.forEach(header => {
      let value = row[header];
      
      // Format common value types
      if (value === null || value === undefined) {
        value = 'N/A';
      } else if (typeof value === 'number') {
        value = formatNumber(value);
      } else if (typeof value === 'string' && (header.includes('time') || header.includes('date') || header === 'timestamp')) {
        value = formatTimestamp(value);
      } else if (typeof value === 'object') {
        value = JSON.stringify(value, null, 2);
      }
      
      html += `<td>${escapeHtml(String(value))}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';

  return html;
}

/**
 * Create a key-value display for configuration data
 */
export function createKeyValueDisplay(data: Record<string, any>): string {
  if (!data || typeof data !== 'object') {
    return '<p class="no-data">No configuration data available</p>';
  }

  const keys = Object.keys(data);
  if (keys.length === 0) {
    return '<p class="no-data">No configuration settings found</p>';
  }

  let html = '<table class="config-table">';
  keys.forEach(key => {
    let value = data[key];
    
    // Format the value
    if (value === null || value === undefined) {
      value = '<em>Not set</em>';
    } else if (typeof value === 'boolean') {
      value = value ? '✓ Yes' : '✗ No';
    } else if (typeof value === 'object') {
      value = '<pre>' + escapeHtml(JSON.stringify(value, null, 2)) + '</pre>';
    } else {
      value = escapeHtml(String(value));
    }

    html += `<tr><td class="key">${escapeHtml(key)}</td><td class="value">${value}</td></tr>`;
  });
  html += '</table>';

  return html;
}

/**
 * Format thermal model data
 */
export function formatThermalData(thermalData: any): DataSection {
  if (!thermalData) {
    return {
      title: 'Thermal Model Data',
      content: '<p class="no-data">No thermal model data available</p>',
      hasData: false
    };
  }

  let html = '';
  
  // Characteristics
  if (thermalData.characteristics) {
    html += '<h4>Thermal Characteristics</h4>';
    html += createKeyValueDisplay(thermalData.characteristics);
  }

  // Data point counts
  html += '<h4>Data Point Summary</h4>';
  html += `<p>Raw data points: <strong>${thermalData.dataPointCount || 0}</strong></p>`;
  html += `<p>Aggregated data points: <strong>${thermalData.aggregatedDataPointCount || 0}</strong></p>`;

  // Recent raw data sample
  if (thermalData.rawData && Array.isArray(thermalData.rawData) && thermalData.rawData.length > 0) {
    html += '<h4>Recent Raw Data (Last 10 points)</h4>';
    const recentData = thermalData.rawData.slice(-10);
    html += createTable(recentData);
  }

  return {
    title: 'Thermal Model Data',
    content: html,
    hasData: !!(thermalData.characteristics || thermalData.dataPointCount > 0)
  };
}

/**
 * Format hot water data
 */
export function formatHotWaterData(hotWaterData: any): DataSection {
  if (!hotWaterData) {
    return {
      title: 'Hot Water Data',
      content: '<p class="no-data">No hot water data available</p>',
      hasData: false
    };
  }

  let html = '';

  // Usage patterns
  if (hotWaterData.patterns) {
    html += '<h4>Usage Patterns</h4>';
    html += createKeyValueDisplay(hotWaterData.patterns);
  }

  // Data point counts
  html += '<h4>Data Point Summary</h4>';
  html += `<p>Usage data points: <strong>${hotWaterData.usageDataPointCount || 0}</strong></p>`;
  html += `<p>Aggregated data points: <strong>${hotWaterData.aggregatedDataPointCount || 0}</strong></p>`;

  // Recent usage data sample
  if (hotWaterData.usageData && Array.isArray(hotWaterData.usageData) && hotWaterData.usageData.length > 0) {
    html += '<h4>Recent Usage Data (Last 10 points)</h4>';
    const recentData = hotWaterData.usageData.slice(-10);
    html += createTable(recentData);
  }

  return {
    title: 'Hot Water Data',
    content: html,
    hasData: !!(hotWaterData.patterns || hotWaterData.usageDataPointCount > 0)
  };
}

/**
 * Format COP data
 */
export function formatCOPData(copData: any): DataSection {
  if (!copData) {
    return {
      title: 'COP Performance Data',
      content: '<p class="no-data">No COP data available</p>',
      hasData: false
    };
  }

  let html = '';

  // COP summary
  html += '<h4>COP Snapshot Summary</h4>';
  html += `<p>Daily snapshots: <strong>${copData.dailyCount || 0}</strong></p>`;
  html += `<p>Weekly snapshots: <strong>${copData.weeklyCount || 0}</strong></p>`;
  html += `<p>Monthly snapshots: <strong>${copData.monthlyCount || 0}</strong></p>`;

  // Recent daily COP data
  if (copData.daily && Array.isArray(copData.daily) && copData.daily.length > 0) {
    html += '<h4>Recent Daily COP Data (Last 10 days)</h4>';
    const recentDaily = copData.daily.slice(-10);
    html += createTable(recentDaily);
  }

  // Recent weekly COP data
  if (copData.weekly && Array.isArray(copData.weekly) && copData.weekly.length > 0) {
    html += '<h4>Recent Weekly COP Data (Last 5 weeks)</h4>';
    const recentWeekly = copData.weekly.slice(-5);
    html += createTable(recentWeekly);
  }

  return {
    title: 'COP Performance Data',
    content: html,
    hasData: !!(copData.dailyCount > 0 || copData.weeklyCount > 0 || copData.monthlyCount > 0)
  };
}

/**
 * Format optimization history
 */
export function formatOptimizationHistory(historyData: any): DataSection {
  if (!historyData) {
    return {
      title: 'Optimization History',
      content: '<p class="no-data">No optimization history available</p>',
      hasData: false
    };
  }

  let html = '';

  // Metrics summary
  if (historyData.metrics) {
    html += '<h4>Optimization Metrics</h4>';
    html += createKeyValueDisplay(historyData.metrics);
  }

  // History summary
  html += '<h4>Optimization History Summary</h4>';
  html += `<p>Total optimization records: <strong>${historyData.historyCount || 0}</strong></p>`;

  // Recent optimization history
  if (historyData.history && Array.isArray(historyData.history) && historyData.history.length > 0) {
    html += '<h4>Recent Optimizations (Last 20)</h4>';
    const recentHistory = historyData.history.slice(-20);
    html += createTable(recentHistory);
  }

  return {
    title: 'Optimization History',
    content: html,
    hasData: !!(historyData.metrics || historyData.historyCount > 0)
  };
}

/**
 * Escape HTML to prevent injection
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format the complete data dump as HTML
 */
export function formatDataDump(dumpData: any): string {
  if (!dumpData || !dumpData.success) {
    return `<div class="error">Error loading data: ${dumpData?.message || 'Unknown error'}</div>`;
  }

  const data = dumpData.data;
  let html = '';

  // Header with metadata
  html += '<div class="data-dump-header">';
  html += `<h3>MELCloud Optimizer Data Dump</h3>`;
  html += `<p><strong>Generated:</strong> ${formatTimestamp(data.metadata?.timestamp || new Date())}</p>`;
  html += `<p><strong>App Version:</strong> ${data.metadata?.appVersion || 'Unknown'}</p>`;
  if (data.metadata?.dataSizeKB) {
    html += `<p><strong>Data Size:</strong> ${data.metadata.dataSizeKB} KB</p>`;
  }
  html += '</div>';

  // Errors section
  if (data.errors && data.errors.length > 0) {
    html += '<details class="error-section"><summary>⚠️ Collection Errors</summary>';
    html += '<ul>';
    data.errors.forEach((error: string) => {
      html += `<li>${escapeHtml(error)}</li>`;
    });
    html += '</ul></details>';
  }

  // Configuration section
  html += '<details class="data-section"><summary>📋 Configuration Settings</summary>';
  html += createKeyValueDisplay(data.configuration || {});
  html += '</details>';

  // Thermal model data
  const thermalSection = formatThermalData(data.thermalModelData);
  html += `<details class="data-section"><summary>🌡️ ${thermalSection.title}</summary>`;
  html += thermalSection.content;
  html += '</details>';

  // Hot water data
  const hotWaterSection = formatHotWaterData(data.hotWaterData);
  html += `<details class="data-section"><summary>🚿 ${hotWaterSection.title}</summary>`;
  html += hotWaterSection.content;
  html += '</details>';

  // COP data
  const copSection = formatCOPData(data.copData);
  html += `<details class="data-section"><summary>⚡ ${copSection.title}</summary>`;
  html += copSection.content;
  html += '</details>';

  // Adaptive parameters
  html += '<details class="data-section"><summary>🧠 Adaptive Parameters</summary>';
  if (data.adaptiveParameters && data.adaptiveParameters.hasData) {
    html += createKeyValueDisplay(data.adaptiveParameters.parameters);
  } else {
    html += '<p class="no-data">No adaptive parameters data available</p>';
  }
  html += '</details>';

  // Optimization history
  const historySection = formatOptimizationHistory(data.optimizationHistory);
  html += `<details class="data-section"><summary>📊 ${historySection.title}</summary>`;
  html += historySection.content;
  html += '</details>';

  // Memory usage
  html += '<details class="data-section"><summary>💾 Memory Usage</summary>';
  if (data.memoryUsage && !data.memoryUsage.error) {
    html += '<h4>Process Memory</h4>';
    if (data.memoryUsage.processMemory) {
      html += createKeyValueDisplay(data.memoryUsage.processMemory);
    }
    if (data.memoryUsage.thermalModelMemory) {
      html += '<h4>Thermal Model Memory</h4>';
      html += createKeyValueDisplay(data.memoryUsage.thermalModelMemory);
    }
  } else {
    html += `<p class="error">Memory usage error: ${data.memoryUsage?.error || 'Unknown error'}</p>`;
  }
  html += '</details>';

  return html;
}
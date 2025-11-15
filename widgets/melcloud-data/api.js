'use strict';

const appApi = require('../../api');

async function callAppModelConfidence(homey) {
  if (appApi && typeof appApi.getModelConfidence === 'function') {
    return appApi.getModelConfidence({ homey });
  }

  throw new Error('Model confidence API is not available');
}

module.exports = {
  async getModelConfidence({ homey }) {
    const envNote = {
      hasAppApi: !!homey?.app?.api,
      hasApiGet: typeof homey?.apiGet,
      hasApiObject: typeof homey?.api,
    };
    if (homey?.app?.log) {
      homey.app.log('[WidgetAPI] getModelConfidence invoked from widget', envNote);
    } else {
      console.log('[WidgetAPI] getModelConfidence invoked', envNote);
    }
    const result = await callAppModelConfidence(homey);

    if (!result || result.success === false) {
      const message = result?.error || 'Failed to load model confidence';
      throw new Error(message);
    }

    return result;
  },
};

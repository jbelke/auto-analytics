/* globals window, document */

// analytics.js may not have loaded it's integrations by the time we start
// tracking events, page views and identifies. So we can use these *WhenReady()
// functions to defer the action until all the intgrations are ready.
// TODO: Consider whether to export something like this, maybe provide our own
//       API instead of just using analytics.js API.
const trackEventWhenReady = (...args) =>
  window.analytics.ready(() => window.analytics.track.apply(this, args));

const trackPageWhenReady = (...args) =>
  window.analytics.ready(() => window.analytics.page.apply(this, args));

const identifyWhenReady = (...args) =>
  window.analytics.ready(() => window.analytics.identify.apply(this, args));


// This is where analytics gets called...
const logPageLoad = ({ referrer, delay }) => {
  // Use setTimeout so it uses the location from after the route change
  // A 50ms delay is used to allow document.title to be updated before capturing the event.
  setTimeout(() => {
    const page = {
      title: document.title,
      referrer,
      path: window.location.pathname,
      search: window.location.search,
      url: window.location.href,
    };
    // Track page on analytics
    trackPageWhenReady(page.title, page);
  }, delay || 0);
};

// A simple wrapper to be explicit about doing the first page load...
const logFirstPageLoad = () => {
  // Ensure we copy over existing state (when it's an object/array) when we use replaceState
  const currentState = typeof window.history.state === 'object' ? window.history.state : null;
  // Store the referrer incase a user uses their browsers back button.
  // NOTE: We only wish to update the state, so we don't pass a 3rd param the URL.
  window.history.replaceState({ ...currentState, referrer: document.referrer }, '');
  logPageLoad({ referrer: document.referrer });
};


// What we're doing here is Monkey Patching(tm) the window.history.pushState()
// function because, currently, the History API provides the 'popstate' event
// but this event only gets fired when history.back(), history.go() are called
// or the user uses the browser buttons, but NOT when history.pushState() is
// called.
const configurePageLoadTracking = () => {
  // Save reference to original pushState.
  const originalPushState = window.history.pushState;

  // Wrap original pushState to call new push state function
  // NOTE: this can't be an arrow function!
  window.history.pushState = function okgrowAnalyticsMonkeyPatchedPushState(...args) {
    // NOTE: We do not use window.location.href as it may contain a fragment identifier.
    const referrer = window.location.origin + window.location.pathname + window.location.search;

    // Modify the params passed to pushState by adding referrer to history.state
    // so we have the correct referrer when browser's back/fwd buttons are used
    const newArgs = [{ ...args[0], referrer }, args[1], args[2]];

    // Make sure we catch any exception here so that we're
    // sure to call the originalPushState function (below)
    try {
      logPageLoad({ referrer });
    } catch (e) {
      console.error(e); // eslint-disable-line no-console
    }

    // Call original pushState with incoming arguments
    return originalPushState.apply(window.history, newArgs);
  };

  window.addEventListener('popstate', () => {
    // If the history is manipulated, by setting a hash for example,
    // the state property may be absent when a popstate is triggered
    const { referrer = '' } = window.history.state || {};

    // NOTE: A delay is added as document.title wont be updated yet if packages
    // like react-helmet or react-document-title, etc... are used.
    logPageLoad({ referrer: referrer || '', delay: 50 });
  }, false);
};

const isEmptyObject = item =>
  typeof item === 'object' && !Object.keys(item).length;

const analyticsStartup = ({ integrations, options = {}, autorun = true }) => {
  if (!isEmptyObject(integrations)) {
    // You can review the function's signature & behaviour with the below link.
    // https://github.com/segmentio/analytics.js-core/blob/master/lib/analytics.js#L93-L105
    window.analytics.initialize(integrations, options);

    if (autorun !== false) {
      logFirstPageLoad();
      configurePageLoadTracking();
    }
  } else {
    console.error('analyticsStartup has failed! Your analytic integrations are missing!'); // eslint-disable-line no-console
  }
};


// What we're doing here is hooking into the window.onload event to:
//
// a) log the first page load, and
// b) setup logging for subsequent page/history changes
//
// NOTE: One concern here is the following scenario:
//
//       1. This code loads
//       2. Some other code loads and replaces window.onload kicking us out
//          BEFORE our function can execute.
//
// Possible solution is that we make analyticsStartup() (above) a public API
// a developer can call to manually set this all up.
const bootstrapAnalytics = (settings) => {
  const originalWindowOnLoad = window.onload;

  if (typeof originalWindowOnLoad === 'function') {
    window.onload = function okgrowAnalyticsMonkeyPatchedOnLoad(...args) {
      analyticsStartup(settings);
      originalWindowOnLoad.apply(this, args);
    };
  } else {
    window.onload = () => analyticsStartup(settings);
  }
};

// returns a string containing any missing functions.
const checkForMissingFunctions = (object = {}, functionsToCheck) => {
  const missingFunctions = functionsToCheck.reduce((accum, funcToCheck) => {
    if (typeof object[funcToCheck] !== 'function') {
      return `${accum}${funcToCheck} ,`;
    }
    return accum;
  }, '');
  return missingFunctions;
};

// Make our helpers available
export { trackEventWhenReady, trackPageWhenReady, identifyWhenReady };

// Main function to initialize analytics
export const initAnalytics = ({
  analytics,
  integrations,
  options = {},
  autorun = true,
} = {}) => {
  // Ensure we have been supplied at least the analytics & segment integration objects.
  if (typeof analytics !== 'object' || typeof integrations !== 'object') {
    throw new Error('Analytics is not logging! You must initialize analytics with the correct params.');
  }

  // Ensure we are not missing the core functions we depend on.
  const expectedAnalyticsFuncs = ['ready', 'track', 'page', 'identify'];
  const missingAnalyticsFuncs = checkForMissingFunctions(analytics, expectedAnalyticsFuncs);
  if (missingAnalyticsFuncs.length) {
    throw new Error(`Analytics is not logging! Expected analytics to contain ${missingAnalyticsFuncs} function(s).`);
  }

  // Alert the user to any Integrations they have setup in their settings,
  // but are missing from the analytics.min.js bundle they have passed to us.
  const missingIntegrations = checkForMissingFunctions(analytics.Integrations, Object.keys(integrations));
  if (missingIntegrations.length) {
    console.warn(`Your analytics is missing the integrations you specified in your settings@ Expected analytics to contain ${missingIntegrations} integration(s).`);
    console.warn('The missing integration(s) will not work without being included in your analytics.js.');
  }

  // Make analytics available globally in the console
  window.analytics = analytics;

  // Set everything up...
  bootstrapAnalytics({ integrations, options, autorun });
};

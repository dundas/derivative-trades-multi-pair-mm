import { LoggerFactory } from './logger-factory.js'; // Assuming logger-factory path

const DEFAULT_RENEWAL_BUFFER_SECONDS = 300; // 5 minutes
const DEFAULT_RETRY_DELAY_SECONDS = 60; // 1 minute

export class KrakenTokenManager {
    /**
     * Manages the lifecycle of a Kraken WebSocket API token.
     * @param {object} options
     * @param {object} options.krakenRestClient - An instance of KrakenRESTClient.
     * @param {object} options.logger - A logger instance.
     * @param {number} [options.renewalBufferSeconds=300] - How many seconds before actual expiry to attempt renewal.
     * @param {number} [options.retryDelaySeconds=60] - How many seconds to wait before retrying a failed token fetch.
     */
    constructor({ krakenRestClient, logger, renewalBufferSeconds, retryDelaySeconds }) {
        if (!krakenRestClient) {
            throw new Error('KrakenTokenManager: krakenRestClient is required.');
        }
        if (!logger) {
            // Fallback to a default logger if none provided, or throw error
            // For now, let's assume LoggerFactory can provide a default or it's handled upstream
            this.logger = LoggerFactory ? LoggerFactory.createLogger('KrakenTokenManager') : console;
            this.logger.warn('KrakenTokenManager: Logger not explicitly provided, using default/console.');
        } else {
            this.logger = logger.createChild ? logger.createChild('KrakenTokenManager') : logger;
        }

        this.krakenRestClient = krakenRestClient;
        this._tokenUpdateCallback = null;

        this.renewalBufferSeconds = renewalBufferSeconds || DEFAULT_RENEWAL_BUFFER_SECONDS;
        this.retryDelaySeconds = retryDelaySeconds || DEFAULT_RETRY_DELAY_SECONDS;

        this.currentToken = null;
        this.tokenExpiresAt = 0; // Timestamp in ms
        this.renewalTimerId = null;
        this.isStarted = false;

        this.logger.info('KrakenTokenManager initialized.');
    }

    registerAdapter(adapter) {
        if (adapter && typeof adapter.updateToken === 'function') {
            this._tokenUpdateCallback = adapter.updateToken.bind(adapter);
            this.logger.info('Exchange adapter registered for token updates.');
        } else {
            this.logger.error('Failed to register adapter: Invalid adapter or missing updateToken method.');
        }
    }

    async start() {
        if (this.isStarted) {
            this.logger.warn('KrakenTokenManager already started.');
            return;
        }
        this.isStarted = true;
        this.logger.info('KrakenTokenManager starting...');
        await this._fetchAndSetToken(); // Fetch initial token
    }

    stop() {
        if (!this.isStarted) {
            this.logger.warn('KrakenTokenManager is not running.');
            return;
        }
        this.isStarted = false;
        if (this.renewalTimerId) {
            clearTimeout(this.renewalTimerId);
            this.renewalTimerId = null;
        }
        this.logger.info('KrakenTokenManager stopped.');
    }

    async _fetchAndSetToken() {
        if (!this.isStarted && this.currentToken) { // Avoid fetching if stopped, unless it's the very first fetch
            this.logger.info('KrakenTokenManager is stopped, skipping token fetch.');
            return;
        }

        this.logger.debug('Attempting to fetch new WebSocket token...');
        try {
            const response = await this.krakenRestClient.getWebSocketToken();
            
            // Updated parsing based on observed response: { expires: 900, token: '...' }
            // Original expected: { error: [], result: { token: "...", expires_in: 1800 } }
            this.logger.debug('[TOKEN_FETCH_DEBUG] Raw response from getWebSocketToken:', JSON.stringify(response));

            let token, expiresInSeconds;

            if (response && response.token && response.expires != null) { // Check for direct token and expires
                token = response.token;
                expiresInSeconds = response.expires; // Assuming 'expires' is in seconds like 'expires_in'
                this.logger.info('[TOKEN_FETCH_DEBUG] Parsed token directly from response root.');
            } else if (response && response.result && response.result.token && response.result.expires_in != null) { // Check for original expected structure
                token = response.result.token;
                expiresInSeconds = response.result.expires_in;
                this.logger.info('[TOKEN_FETCH_DEBUG] Parsed token from response.result structure.');
            } else {
                this.logger.error('Failed to fetch WebSocket token: Invalid or unrecognized response structure.', response);
                if (this.isStarted) {
                    this._scheduleRenewal(true); // Schedule a retry on failure
                }
                return; // Exit if structure is not recognized
            }

            this.currentToken = token;
            const expiresInMs = expiresInSeconds * 1000;
            this.tokenExpiresAt = Date.now() + expiresInMs;
            
            this.logger.info(`Successfully fetched new WebSocket token. Expires in: ${expiresInSeconds}s (at ${new Date(this.tokenExpiresAt).toISOString()}).`);
            
            if (this._tokenUpdateCallback) {
                this._tokenUpdateCallback(this.currentToken);
                this.logger.info('Token update callback invoked.');
            } else {
                this.logger.warn('No token update callback registered. Adapter will not receive token updates directly from TokenManager.');
            }
            this._scheduleRenewal();
        } catch (error) {
            this.logger.error('Error fetching WebSocket token:', { message: error.message, stack: error.stack });
            if (this.isStarted) {
                this._scheduleRenewal(true); // Schedule a retry on error
            }
        }
    }

    _scheduleRenewal(isRetry = false) {
        if (!this.isStarted) {
            this.logger.info('KrakenTokenManager is stopped, renewal scheduling cancelled.');
            return;
        }

        if (this.renewalTimerId) {
            clearTimeout(this.renewalTimerId);
            this.renewalTimerId = null;
        }

        let delayMs;
        if (isRetry) {
            delayMs = this.retryDelaySeconds * 1000;
            this.logger.info(`Scheduling token fetch retry in ${this.retryDelaySeconds}s.`);
        } else {
            const renewalTime = this.tokenExpiresAt - (this.renewalBufferSeconds * 1000);
            delayMs = Math.max(0, renewalTime - Date.now()); // Ensure delay is not negative
            this.logger.info(`Scheduling next token renewal at ${new Date(renewalTime).toISOString()} (in approx. ${Math.round(delayMs / 1000 / 60)} minutes).`);
        }

        if (delayMs < 0) { // Should ideally be caught by Math.max(0, ...)
            this.logger.warn(`Calculated renewal delay is negative (${delayMs}ms). This might indicate the token has already expired or renewalBuffer is too large. Attempting immediate renewal.`);
            delayMs = 0;
        }

        this.renewalTimerId = setTimeout(async () => {
            await this._fetchAndSetToken();
        }, delayMs);
    }

    getCurrentToken() {
        return this.currentToken;
    }
} 
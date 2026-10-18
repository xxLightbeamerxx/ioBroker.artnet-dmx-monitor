'use strict';

/**
 * Art-Net DMX Monitor v1.0.1
 */
const dgram = require('node:dgram');
const { parseArtPoll, createArtPollReply, pickLocalIp } = require('./lib/poll');
const utils = require('@iobroker/adapter-core');
const { parseArtDmx } = require('./lib/artnet');
const { channelId, channelsToRemove, obsoleteUniverses, validateConfig, overlaps } = require('./lib/config');

class ArtnetDmxMonitor extends utils.Adapter {
    constructor(options) {
        super({ ...options, name: 'artnet-dmx-monitor' });
        this.socket = null;
        this.healthTimer = null;
        this.conflictTimer = null;
        this.conflictCheckRunning = false;
        this.lastReportedConflicts = '';
        this.stopping = false;
        this.lastValues = new Array(513);
        this.lastSeenAt = 0;
        this.lastSource = '';
        this.packetCount = 0;
        this.reportedPacketCount = -1;
        this.dmxReceiving = false;
        this.pollTimers = new Set();
        this.on('ready', () => void this.onReady());
        this.on('unload', callback => this.onUnload(callback));
    }

    /** Creates a read-only ioBroker state if it does not already exist. */
    async ensureState(id, name, type, role, def, extra = {}) {
        await this.setObjectNotExistsAsync(id, {
            type: 'state',
            common: { name, type, role, read: true, write: false, def, ...extra },
            native: {},
        });
    }

    /** Creates configured channel states and removes channels that are no longer selected. */
    async syncChannelObjects() {
        // Remove old universe branches BEFORE creating the currently configured one.
        // Query channel definitions only in this adapter instance, never other adapters.
        const objectPrefix = `${this.namespace}.`;
        const channelView = await this.getObjectViewAsync('system', 'channel', {
            startkey: objectPrefix,
            endkey: `${objectPrefix}\uffff`,
        });
        const oldUniverses = obsoleteUniverses(
            (channelView.rows || []).map(row => row.id), this.namespace, this.universe,
        );
        for (const oldUniverse of oldUniverses) {
            const prefix = `${this.namespace}.${oldUniverse}.channel.`;
            const stateView = await this.getObjectViewAsync('system', 'state', {
                startkey: prefix,
                endkey: `${prefix}\uffff`,
            });
            for (const row of stateView.rows || []) {
                if (typeof row.id !== 'string' || !row.id.startsWith(prefix)) continue;
                const relativeId = row.id.slice(this.namespace.length + 1);
                try { await this.delStateAsync(relativeId); } catch (err) {
                    this.log.debug(`Old state ${relativeId} already empty: ${err.message}`);
                }
                await this.delObjectAsync(relativeId);
            }
            // Delete the container objects last. No recursive deletion or broad namespace wipes.
            const oldChannelId = `${oldUniverse}.channel`;
            if ((channelView.rows || []).some(row => row.id === `${this.namespace}.${oldChannelId}`)) {
                await this.delObjectAsync(oldChannelId);
            }
            await this.delObjectAsync(oldUniverse);
            this.log.info(`Removed obsolete Art-Net universe ${oldUniverse}.`);
        }

        await this.setObjectNotExistsAsync(String(this.universe), {
            type: 'channel', common: { name: `Art-Net universe ${this.universe}` }, native: {},
        });
        await this.setObjectNotExistsAsync(`${this.universe}.channel`, {
            type: 'channel', common: { name: 'DMX channels' }, native: {},
        });

        // Query only state objects under the channel.* branch of this adapter instance.
        const prefix = `${this.namespace}.${this.universe}.channel.`;
        const view = await this.getObjectViewAsync('system', 'state', {
            startkey: prefix,
            endkey: `${prefix}\uffff`,
        });
        const existing = (view.rows || []).map(row => row.id).filter(id => typeof id === 'string' && id.startsWith(prefix));
        const stale = channelsToRemove(existing, this.namespace, this.universe, this.startChannel, this.channelCount);
        for (const fullId of stale) {
            const relativeId = fullId.slice(this.namespace.length + 1);
            // delStateAsync removes the state value; delObjectAsync removes its object definition.
            // A missing state value is normal during initial setup.
            try { await this.delStateAsync(relativeId); } catch (err) {
                this.log.debug(`Old state ${relativeId} already empty: ${err.message}`);
            }
            await this.delObjectAsync(relativeId);
        }
        if (stale.length) this.log.info(`${stale.length} obsolete DMX channel states removed.`);

        for (let ch = this.startChannel; ch < this.startChannel + this.channelCount; ch++) {
            await this.ensureState(channelId(this.universe, ch), `DMX channel ${ch}`, 'number', 'value', 0, { min: 0, max: 255 });
        }
    }

    /**
     * Read-only conflict diagnostics. Never rebind, close, probe or change our UDP socket.
     * Only ioBroker Art-Net instance configurations can be inspected reliably here.
     * Third-party applications that start later are not detected by this check.
     */
    async checkConfiguredPortConflicts() {
        if (this.stopping || this.conflictCheckRunning) return;
        this.conflictCheckRunning = true;
        try {
            const view = await this.getObjectViewAsync('system', 'instance', {
                startkey: 'system.adapter.', endkey: 'system.adapter.\uffff',
            });
            if (this.stopping) return;
            const conflicts = [];
            for (const row of view.rows || []) {
                const obj = row.value || row.doc;
                if (!obj || row.id === `system.adapter.${this.namespace}` || obj.common?.enabled === false) continue;
                if (!/artnet|art-net/i.test(row.id)) continue;
                const native = obj.native || {};
                if (overlaps(this.bindAddress, this.port, native.bind, native.port)) conflicts.push(row.id);
            }
            conflicts.sort();
            const signature = conflicts.join(',');
            if (signature !== this.lastReportedConflicts) {
                if (conflicts.length) {
                    this.log.warn(`POSSIBLE ART-NET PORT CONFLICT: ${conflicts.join(', ')} also configured for UDP ${this.port}. Only one receiver per IP address and port is recommended.`);
                } else if (this.lastReportedConflicts) {
                    this.log.info('Previously detected Art-Net instance configuration conflict is no longer present.');
                }
                this.lastReportedConflicts = signature;
                // This status indicates a known configuration conflict, not a socket bind failure.
                await this.setStateAsync('info.portConflict', { val: conflicts.length > 0, ack: true });
            }
        } catch (err) {
            if (!this.stopping) this.log.debug(`Unable to inspect other ioBroker Art-Net instances: ${err.message}`);
        } finally {
            this.conflictCheckRunning = false;
        }
    }

    async onReady() {
        try {
            const cfg = validateConfig(this.config);
            Object.assign(this, cfg);

            await this.ensureState('info.connection', 'Art-Net UDP listener ready', 'boolean', 'indicator.reachable', false);
            await this.extendObjectAsync('info.connection', { common: { name: 'Art-Net UDP listener ready' } });
            await this.ensureState('info.receiving', 'ArtDMX packets received recently', 'boolean', 'indicator.reachable', false);
            await this.ensureState('info.portConflict', 'UDP port conflict', 'boolean', 'indicator', false);
            await this.ensureState('info.lastPacket', 'Last ArtDMX packet (Unix milliseconds)', 'number', 'value.time', 0);
            await this.ensureState('info.lastSender', 'Last sender IP address', 'string', 'text', '');
            await this.ensureState('info.packetCount', 'Matching ArtDMX packets received since startup', 'number', 'value', 0);
            await this.ensureState('info.universe', 'Selected Art-Net universe', 'number', 'value', this.universe);
            await this.setStateAsync('info.connection', { val: false, ack: true });
            await this.setStateAsync('info.receiving', { val: false, ack: true });
            await this.setStateAsync('info.portConflict', { val: false, ack: true });
            await this.setStateAsync('info.universe', { val: this.universe, ack: true });
            await this.setStateAsync('info.packetCount', { val: 0, ack: true });
            await this.syncChannelObjects();
            await this.checkConfiguredPortConflicts();

            this.socket = dgram.createSocket('udp4');
            this.socket.on('message', (data, remote) => {
                if (this.respondToPoll && parseArtPoll(data)) {
                    this.respondToArtPoll(remote);
                } else {
                    this.handlePacket(data, remote);
                }
            });
            this.socket.on('error', err => {
                if (this.stopping) return;
                if (err.code === 'EADDRINUSE') {
                    this.log.error(`ART-NET PORT CONFLICT: ${this.bindAddress}:${this.port} is already in use. Stop the other application or choose another port/bind address.`);
                    void this.setStateAsync('info.portConflict', { val: true, ack: true }).catch(e => this.log.debug(e.message));
                } else {
                    this.log.error(`UDP error: ${err.message}`);
                }
                void this.setStateAsync('info.connection', { val: false, ack: true }).catch(e => this.log.debug(e.message));
                void this.setStateAsync('info.receiving', { val: false, ack: true }).catch(e => this.log.debug(e.message));
                if (this.healthTimer) clearInterval(this.healthTimer);
                this.healthTimer = null;
                this.socket?.close();
                this.socket = null;
            });
            this.socket.on('listening', () => {
                if (this.stopping) return;
                void this.setStateAsync('info.connection', { val: true, ack: true }).catch(e => this.log.warn(`Could not set receiver readiness: ${e.message}`));
                this.log.info(`Art-Net DMX Monitor listening: ${this.bindAddress}:${this.port}, Universe ${this.universe}, channels ${this.startChannel}–${this.startChannel + this.channelCount - 1}`);
            });
            this.socket.bind(this.port, this.bindAddress);
            this.healthTimer = setInterval(() => this.updateHealth(), 1000);
            // A metadata-only query every 10 minutes; never touches the UDP listener.
            this.conflictTimer = setInterval(() => {
                void this.checkConfiguredPortConflicts();
            }, 10 * 60 * 1000);
        } catch (err) {
            this.log.error(`Adapter startup failed: ${err.stack || err.message}`);
            try { await this.setStateAsync('info.connection', { val: false, ack: true }); } catch { /* The state may not exist yet */ }
        }
    }

    /** Reply only to valid ArtPoll requests, with a randomized delay to avoid network bursts. */
    respondToArtPoll(remote) {
        if (this.stopping || !this.socket) return;
        const timer = setTimeout(() => {
            this.pollTimers.delete(timer);
            if (this.stopping || !this.socket) return;
            const ip = pickLocalIp(this.bindAddress, remote.address);
            if (!ip) {
                this.log.warn('Cannot respond to ArtPoll: no suitable local IPv4 address available.');
                return;
            }
            const receiving = this.lastSeenAt > 0 && Date.now() - this.lastSeenAt <= this.timeoutMs;
            let reply;
            try { reply = createArtPollReply({ ip, universe: this.universe, shortName: this.pollShortName, receiving }); }
            catch (err) { this.log.warn(`ArtPollReply could not be prepared: ${err.message}`); return; }
            // ArtPollReply is UNICAST to the requesting controller, never broadcast.
            this.socket.send(reply, 6454, remote.address, err => {
                if (err && !this.stopping) this.log.warn(`Could not send ArtPollReply to ${remote.address}: ${err.message}`);
            });
        }, Math.floor(Math.random() * 1000));
        this.pollTimers.add(timer);
    }

    /** Process only ArtDMX packets for the selected universe, with values from 0 to 255. */
    handlePacket(buffer, remote) {
        if (this.stopping) return;
        const packet = parseArtDmx(buffer);
        if (!packet || packet.universe !== this.universe) return;
        this.lastSeenAt = Date.now();
        this.packetCount++;
        if (remote.address !== this.lastSource) {
            this.lastSource = remote.address;
            this.setState('info.lastSender', { val: remote.address, ack: true });
        }
        for (let ch = this.startChannel; ch < this.startChannel + this.channelCount; ch++) {
            // Do not reset missing channels to zero when a short DMX packet arrives.
            if (ch > packet.data.length) continue;
            const value = packet.data[ch - 1];
            if (this.onlyChanges && this.lastValues[ch] === value) continue;
            this.lastValues[ch] = value;
            this.setState(channelId(this.universe, ch), { val: value, ack: true });
        }
    }

    /** Refresh connection status and diagnostics at most once per second. */
    updateHealth() {
        if (this.stopping) return;
        const online = this.lastSeenAt > 0 && Date.now() - this.lastSeenAt <= this.timeoutMs;
        if (online !== this.dmxReceiving) {
            this.dmxReceiving = online;
            this.setState('info.receiving', { val: online, ack: true });
        }
        if (this.reportedPacketCount !== this.packetCount) {
            this.reportedPacketCount = this.packetCount;
            this.setState('info.packetCount', { val: this.packetCount, ack: true });
            this.setState('info.lastPacket', { val: this.lastSeenAt, ack: true });
        }
    }

    /** Shut down cleanly so the UDP port is released for the next start. */
    onUnload(callback) {
        this.stopping = true;
        // Do not write info states here: during adapter removal their objects may
        // already have been deleted by the controller.
        for (const timer of this.pollTimers) clearTimeout(timer);
        this.pollTimers.clear();
        if (this.healthTimer) clearInterval(this.healthTimer);
        if (this.conflictTimer) clearInterval(this.conflictTimer);
        if (this.socket) {
            try { this.socket.close(); } catch (err) { this.log.debug(err.message); }
        }
        callback();
    }
}

if (require.main !== module) {
    module.exports = options => new ArtnetDmxMonitor(options);
} else {
    new ArtnetDmxMonitor();
}

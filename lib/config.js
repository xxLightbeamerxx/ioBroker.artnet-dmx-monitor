'use strict';
/** Small helper functions that can be tested independently of ioBroker. */
const channelId = (universe, ch) => `${universe}.channel.${String(ch).padStart(3, '0')}`;

function validateConfig(cfg) {
    const port = Number(cfg.port ?? 6454);
    const bindAddress = String(cfg.bind || '0.0.0.0').trim();
    const universe = Number(cfg.universe ?? 0);
    const startChannel = Number(cfg.startChannel ?? 1);
    const channelCount = Number(cfg.channelCount ?? 64);
    const timeoutSeconds = Number(cfg.timeoutSeconds ?? 10);
    if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(bindAddress) || bindAddress.split('.').some(p => Number(p) > 255)) {
        throw new Error('Bind address must be an IPv4 address.');
    }
    for (const [label, number, min, max] of [
        ['Port', port, 1, 65535], ['Universe', universe, 0, 32767],
        ['First channel', startChannel, 1, 512], ['Channel count', channelCount, 1, 512],
        ['Timeout', timeoutSeconds, 1, 3600],
    ]) {
        if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be between ${min} and ${max}.`);
    }
    if (startChannel + channelCount > 513) throw new Error('First channel + channel count must not exceed channel 512.');
    const pollShortName = String(cfg.pollShortName ?? 'ioB ArtNet Mon').trim();
    if (!pollShortName || Buffer.byteLength(pollShortName, 'ascii') > 17 || /[^\x20-\x7e]/.test(pollShortName)) {
        throw new Error('ArtPoll short name must be 1–17 printable ASCII characters.');
    }
    return { respondToPoll: cfg.respondToPoll === true, pollShortName, port, bindAddress, universe, startChannel, channelCount, timeoutMs: timeoutSeconds * 1000, onlyChanges: cfg.onlyChanges !== false };
}

/** Remove only channel.NNN states belonging to this instance; never delete unrelated objects. */
function channelsToRemove(ids, namespace, universe, startChannel, channelCount) {
    const prefix = `${namespace}.${universe}.channel.`;
    return ids.filter(id => {
        if (!id.startsWith(prefix)) return false;
        const suffix = id.slice(prefix.length);
        if (!/^\d{3}$/.test(suffix)) return false;
        const n = Number(suffix);
        return n < startChannel || n >= startChannel + channelCount;
    });
}

/** Discover old universe branches belonging to this adapter instance only. */
function obsoleteUniverses(channelObjectIds, namespace, selectedUniverse) {
    const prefix = `${namespace}.`;
    const selected = String(selectedUniverse);
    const found = new Set();
    for (const id of channelObjectIds) {
        if (typeof id !== 'string' || !id.startsWith(prefix)) continue;
        const relative = id.slice(prefix.length);
        const match = /^(\d{1,5})(?:\.channel)?$/.exec(relative);
        if (match && Number(match[1]) <= 32767 && match[1] !== selected) found.add(match[1]);
    }
    return [...found].sort((a, b) => Number(a) - Number(b));
}

/** Check whether two configured IPv4 bind addresses may overlap. */
function overlaps(bindA, portA, bindB, portB) {
    if (bindB == null || portB == null || Number(portA) !== Number(portB)) return false;
    return bindA === '0.0.0.0' || bindB === '0.0.0.0' || bindA === bindB;
}
module.exports = { channelId, validateConfig, channelsToRemove, obsoleteUniverses, overlaps };

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArtPoll, createArtPollReply, pickLocalIp } = require('../lib/poll');
const poll = Buffer.alloc(14);
poll.write('Art-Net\0', 0, 'ascii');
poll.writeUInt16LE(0x2000, 8);
poll.writeUInt16BE(14, 10);

test('ArtPoll parser requires valid header, opcode and protocol revision', () => {
    assert.ok(parseArtPoll(poll));
    assert.equal(parseArtPoll(Buffer.alloc(14)), null);
    const invalid = Buffer.from(poll); invalid.writeUInt16LE(0x5000, 8);
    assert.equal(parseArtPoll(invalid), null);
    invalid.writeUInt16LE(0x2000, 8); invalid.writeUInt16BE(13, 10);
    assert.equal(parseArtPoll(invalid), null);
});
test('ArtPollReply encodes Art-Net 4 header, local address and virtual output universe', () => {
    const r = createArtPollReply({ip:'192.168.1.23',universe:0x1234,shortName:'ioBroker DMX Mon'});
    assert.equal(r.length,239);
    assert.equal(r.toString('ascii',0,8),'Art-Net\0');
    assert.equal(r.readUInt16LE(8),0x2100);
    assert.deepEqual([...r.subarray(10,14)],[192,168,1,23]);
    assert.equal(r.readUInt16LE(14),6454);
    assert.equal(r[18],0x12);assert.equal(r[19],0x03);assert.equal(r[190],0x04);
    assert.equal(r.readUInt16BE(172),1);assert.equal(r[174],0x80);
    assert.equal(r[200],5);assert.equal(r[211],1);
    assert.deepEqual([...r.subarray(207,211)],[192,168,1,23]);
});
test('ArtPollReply reports receiving state, and local address chooser matches subnet', () => {
    const r=createArtPollReply({ip:'10.1.2.3',universe:0,receiving:true});
    assert.equal(r[182],0x80);
    const interfaces={a:[{family:'IPv4',internal:false,address:'10.1.2.3',netmask:'255.255.255.0'}],b:[{family:'IPv4',internal:false,address:'192.168.3.7',netmask:'255.255.255.0'}]};
    assert.equal(pickLocalIp('0.0.0.0','192.168.3.9',interfaces),'192.168.3.7');
    assert.equal(pickLocalIp('10.1.2.3','192.168.3.9',interfaces),'10.1.2.3');
});

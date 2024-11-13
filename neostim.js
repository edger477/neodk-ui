
// private helpers
class PortEventManager {
    constructor() {
        this.subscribers = {};
        this.portSubscribers = function (port) {
            this.subscribers[port] = this.subscribers[port] || [];
            return this.subscribers[port];
        }
    }


    // Method to add a subscriber
    subscribe(port, callback) {
        this.portSubscribers(port).push(callback);
    }

    // Method to remove a subscriber
    unsubscribe(port, callback) {
        this.portSubscribers(port) = this.portSubscribers(port).filter(subscriber => subscriber !== callback);
    }

    // Method to notify all subscribers (call each one)
    notify(port, data) {
        this.portSubscribers(port).forEach(callback => callback(data));
    }
}


// Copyright 2024 Neostim B.V. All rights reserved.

"use strict";

const FRAME_HEADER_SIZE = 8;
const MAX_PAYLOAD_SIZE = 512;
const PACKET_HEADER_SIZE = 6;
const ATTR_ACTION_SIZE = 6;

const FRAME_TYPE_NONE = 0;
const FRAME_TYPE_ACK = 1;
const FRAME_TYPE_SYNC = 3;
const FRAME_TYPE_DATA = 4;

// Network service types.
const NST_DEBUG = 0;
const NST_DATAGRAM = 1;

// Request types (aka opcodes).
const OC_READ_REQUEST = 2;
const OC_SUBSCRIBE_REQUEST = 3;
const OC_REPORT_DATA = 5;
const OC_WRITE_REQUEST = 6;
const OC_INVOKE_REQUEST = 8;

// Attribute IDs.
const AI_ALL_PATTERN_NAMES = 5;
const AI_CURRENT_PATTERN_NAME = 6;
const AI_INTENSITY_PERCENT = 7;
const AI_PLAY_PAUSE_STOP = 8;

// Encodings.
const EE_UNSIGNED_INT_1 = 4;
const EE_UTF8_1LEN = 12;
const EE_ARRAY = 22;
const EE_END_OF_CONTAINER = 24;


const rx_frame = new Uint8Array(FRAME_HEADER_SIZE + MAX_PAYLOAD_SIZE);
let rx_nb = 0;
let incoming_payload_size = 0;

let the_writer = null;
let tx_seq_nr = 0;
let transaction_id = 1959;


function initFrame(payload_size, frame_type, service_type, seq) {
    const frame = new Uint8Array(FRAME_HEADER_SIZE + payload_size);
    frame[0] = (service_type << 4) | (frame_type << 1);
    frame[1] = seq << 3;
    frame[2] = (payload_size >> 8) & 0xff;
    frame[3] = payload_size & 0xff;
    frame[4] = 0;
    return frame;
}


function crcFrame(frame) {
    frame[5] = crc8_ccitt(0, frame, 5);
    let crc16 = crc16_ccitt(0xffff, frame, 6);
    crc16 = crc16_ccitt(crc16, frame.slice(FRAME_HEADER_SIZE), frame.length - FRAME_HEADER_SIZE);
    frame[6] = (crc16 >> 8);
    frame[7] = crc16 & 0xff;
    return frame;
}


function makeAckFrame(service_type, ack) {
    const frame = initFrame(0, FRAME_TYPE_ACK, service_type, 0);
    frame[0] |= 1;
    frame[1] |= (ack & 0x7);
    return crcFrame(frame);
}


function makeSyncFrame(service_type) {
    return crcFrame(initFrame(0, FRAME_TYPE_SYNC, service_type, tx_seq_nr++));
}


function makeCommandFrame(cmnd_str) {
    const enc_cmnd = new TextEncoder().encode(cmnd_str);
    const frame = initFrame(enc_cmnd.length, FRAME_TYPE_DATA, NST_DEBUG, tx_seq_nr++);
    frame.set(enc_cmnd, FRAME_HEADER_SIZE);
    return crcFrame(frame);
}


function makeRequestPacketFrame(trans_id, request_type, attribute_id, data) {
    let packet_size = PACKET_HEADER_SIZE + ATTR_ACTION_SIZE;
    if (data !== null) packet_size += data.length;
    const frame = initFrame(packet_size, FRAME_TYPE_DATA, NST_DATAGRAM, tx_seq_nr++);
    let offset = FRAME_HEADER_SIZE;
    // Initialise the packet header - to all zeroes, for now.
    for (let i = 0; i < PACKET_HEADER_SIZE; i++) frame[offset++] = 0x00;
    frame[offset++] = trans_id & 0xff;
    frame[offset++] = (trans_id >> 8) & 0xff;
    frame[offset++] = request_type & 0xff;
    frame[offset++] = 0x00;
    frame[offset++] = attribute_id & 0xff;
    frame[offset++] = (attribute_id >> 8) & 0xff;
    if (data !== null) frame.set(data, offset);
    return crcFrame(frame);
}


function sendAttrReadRequest(writer, attribute_id) {
    sendFrame(writer, makeRequestPacketFrame(transaction_id++, OC_READ_REQUEST, attribute_id, null));
}


function sendAttrSubscribeRequest(writer, attribute_id) {
    sendFrame(writer, makeRequestPacketFrame(transaction_id++, OC_SUBSCRIBE_REQUEST, attribute_id, null));
}


async function sendFrame(writer, frame) {
    // console.log('sendFrame, size=' + frame.length);
    await writer.write(frame);
}

const debugEventManager = new PortEventManager();

function handleIncomingDebugPacket(chunk, port) {
    const response_box = document.getElementById('response-box');
    var data = new TextDecoder().decode(chunk);
    response_box.value += data;
    response_box.scrollTop = response_box.scrollHeight;
    debugEventManager.notify(port, data);
}


function unpackPatternNames(enc_names, port) {
    const decoder = new TextDecoder();
    let pos = 0;
    while (pos < enc_names.length && enc_names[pos] == EE_UTF8_1LEN) {
        pos += 1;
        const len = enc_names[pos++];
        let name = decoder.decode(enc_names.slice(pos, pos + len));
        console.log('  ' + name);
        patternNamesEventManager.notify(port, name);
        pos += len;
    }
    return pos;
}

const intensityEventManager = new PortEventManager();
const playStateEventManager = new PortEventManager();
const currentPatternEventManager = new PortEventManager();
const patternNamesEventManager = new PortEventManager();


function handleReportedData(aa, port) {
    const attribute_id = aa[4] | (aa[5] << 8);
    let offset = ATTR_ACTION_SIZE;
    const data_length = aa.length - offset;
    switch (attribute_id) {
        case AI_ALL_PATTERN_NAMES:
            if (data_length >= 2 && aa[offset] == EE_ARRAY) {
                console.log('Avalaible patterns:');
                offset += unpackPatternNames(aa.slice(offset + 1), port);
            }
            break;
        case AI_CURRENT_PATTERN_NAME:
            if (aa[offset] == EE_UTF8_1LEN) {
                let name = new TextDecoder().decode(aa.slice(offset + 2));
                console.log('Current pattern is ' + name);
                currentPatternEventManager.notify(port, name);
            }
            break;
        case AI_INTENSITY_PERCENT:
            if (aa[offset] == EE_UNSIGNED_INT_1) {
                const intensity_perc = aa[offset + 1];
                console.log('Intensity is ' + intensity_perc + '%');
                intensityEventManager.notify(port, intensity_perc);
            }
            break;
        case AI_PLAY_PAUSE_STOP:
            if (aa[offset] == EE_UNSIGNED_INT_1) {
                const state_str = ["what?", "stopped", "paused", "playing"];
                const play_state = aa[offset + 1];
                if (play_state >= 4) play_state = 0;
                console.log('NeoDK is ' + state_str[play_state]);
                playStateEventManager.notify(port, { play_state: play_state, play_state_name: state_str[play_state] });
            }
            break;
        default:
            console.log('Unexpected attribute id: ' + attribute_id);
    }
}


function handleIncomingDatagram(datagram, port) {
    const offset = PACKET_HEADER_SIZE;
    const opcode = datagram[offset + 2];
    if (opcode == OC_REPORT_DATA) {
        handleReportedData(datagram.slice(offset), port)
    } else {
        const tr_id = datagram[offset] | (datagram[offset + 1] << 8);
        console.log('Transaction ID=' + tr_id + ', opcode=' + opcode);
    }
}


function assembleIncomingFrame(b) {
    rx_frame[rx_nb++] = b;
    // Collect bytes until we have a complete header.
    if (rx_nb < FRAME_HEADER_SIZE) return FRAME_TYPE_NONE;

    // Shift/append the input buffer until it contains a valid header.
    if (rx_nb == FRAME_HEADER_SIZE) {
        if (rx_frame[5] != (crc8_ccitt(0, rx_frame, 5) & 0xff)) {
            rx_nb -= 1;
            for (let i = 0; i < rx_nb; i++) rx_frame[i] = rx_frame[i + 1];
            return FRAME_TYPE_NONE;
        }
        // Valid header received, start collecting the payload (if any).
        if ((incoming_payload_size = (rx_frame[2] << 8) | rx_frame[3]) > MAX_PAYLOAD_SIZE) {
            console.log('Frame payload too big: ' + incoming_payload_size + ' bytes');
            incoming_payload_size = 0;
            rx_nb = 0;
            return FRAME_TYPE_NONE;
        }
    }
    if (rx_nb == FRAME_HEADER_SIZE + incoming_payload_size) {
        rx_nb = 0;
        return (rx_frame[0] >> 1) & 0x7;
    }
    return FRAME_TYPE_NONE;
}


function processIncomingData(value, port) {
    for (let i = 0; i < value.length; i++) {
        const frame_type = assembleIncomingFrame(value[i]);
        if (frame_type == FRAME_TYPE_NONE) continue;

        if (frame_type == FRAME_TYPE_ACK) {
            const ack = rx_frame[1] & 0x7;
            // console.log('Got ACK ' + ack);
            continue;
        }

        const service_type = (rx_frame[0] >> 4) & 0x3;
        if (frame_type == FRAME_TYPE_DATA) {
            const seq = (rx_frame[1] >> 3) & 0x7;
            sendFrame(port.the_writer, makeAckFrame(service_type, seq));
        }
        // console.log('Service type is ' + service_type + ', payload size is ' + incoming_payload_size);
        if (incoming_payload_size == 0) continue;

        const packet = rx_frame.slice(FRAME_HEADER_SIZE, FRAME_HEADER_SIZE + incoming_payload_size);
        if (service_type == NST_DEBUG) {
            handleIncomingDebugPacket(packet, port);
        } else if (service_type == NST_DATAGRAM) {
            handleIncomingDatagram(packet, port);
        }
    }
}


async function readIncomingData(port) {
    var reader = port.readable.getReader();
    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            reader.releaseLock();
            break;
        }
        // console.log('Incoming data length is ' + value.length);
        processIncomingData(value, port);
    }
}


async function usePort(port) {
    await port.open({ baudRate: 115200 }).then(() => {
        console.log('Opened port ', port.getInfo());
        the_writer = port.writable.getWriter();
        sendFrame(the_writer, makeSyncFrame(NST_DEBUG));

        readIncomingData(port);

        // We have one readable attribute and three we can subscribe to.
        sendAttrReadRequest(the_writer, AI_ALL_PATTERN_NAMES);
        sendAttrSubscribeRequest(the_writer, AI_CURRENT_PATTERN_NAME);
        sendAttrSubscribeRequest(the_writer, AI_INTENSITY_PERCENT);
        sendAttrSubscribeRequest(the_writer, AI_PLAY_PAUSE_STOP);
        port.the_writer = the_writer;
    });
}


async function selectPort(evt) {
    const filters = [
        { usbVendorId: 0x0403 },    // FTDI
        { usbVendorId: 0x067b },    // Prolific
        { usbVendorId: 0x10c4 },    // Silicon Labs
        { usbVendorId: 0x1a86 },    // WCH (CH340 chip)
        { usbVendorId: 0x16d0, usbProductId: 0x12ef }
    ];
    return navigator.serial.requestPort({ filters })
        .then(async (port) => {
            port.onconnect = () => {
                console.log('Connected', port.getInfo());
            }
            port.ondisconnect = () => {
                console.log('Disconnected', port.getInfo());
                writer.releaseLock();
                writer = null;
            }
            //document.getElementById('command-box').focus();
            await usePort(port);
            return port;
        })
        .catch((e) => {
            console.log('No port selected');
        });
}


function crc8_ccitt(crc, data, size) {
    for (let i = 0; i < size; i++) {
        crc ^= data[i];
        for (let k = 0; k < 8; k++) {
            crc = crc & 0x80 ? (crc << 1) ^ 0x07 : crc << 1;
        }
    }
    return crc;
}


function crc16_ccitt(crc, data, size) {
    for (let i = 0; i < size; i++) {
        crc ^= data[i] << 8;
        for (let k = 0; k < 8; k++) {
            crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
        }
    }
    return crc;
}


function handleConsoleInput(evt) {
    const input = evt.target;
    const cmnd = input.value;
    if ((cmnd[0] == '/' && cmnd.length == 2) || (evt.key == 'Enter')) {
        sendFrame(the_writer, makeCommandFrame(cmnd));
        input.value = '';
    }
}


function setUnloadHandler(evt) {
    window.addEventListener(evt, function () {
        // TODO Inform the power box that the UI has left.
    }, true);
}


function mainProgram() { //packing it into function for reference since I don't need it
    /**
     * Main program.
     */
    window.addEventListener('DOMContentLoaded', function () {
        window.onerror = function (msg, url, lineNo, columnNo, error) {
            console.error(msg);
            console.trace();
            return false;                                           // TODO Report the exception to the server.
        }

        const visEventName = (typeof document.webkitHidden !== 'undefined' ? 'webkitvisibilitychange' : 'visibilitychange');
        document.addEventListener(visEventName, function () {
            console.log('Visibility: ' + document.visibilityState);
        }, false);

        if ('onbeforeunload' in window) {
            setUnloadHandler('beforeunload');
        } else {
            setUnloadHandler('pagehide');                           // Similar to beforeunload, on most mobile devices.
        }

        console.log('NUUI v0.23');
        if ('serial' in navigator) {
            document.getElementById('get-ports').onclick = selectPort;
            document.getElementById('command-box').onkeyup = handleConsoleInput;
        } else {
            console.log('Your browser does not support the WebSerial API');
        }
    });
}

/**
 *  wrapper to send commands to box
 */
function sendCommand(command, port) {
    sendFrame(port.the_writer, makeCommandFrame(command));
}
import { reactive, ref, computed } from 'vue'

class NeoDK {
    /**
     *
     */
    constructor({ port }) {
        this._port = port;
        this._intensityPercent = ref(0);
        this._state = reactive({ play_state: '', play_state_name: '' });
        this._currentPattern = ref('');
        this.version = ref('');
        this._vcap = ref(0);
        this._vbat = ref(0);
        var instance = this;

        this._intensityChanged = function (intensity_perc) {
            instance._intensityPercent.value = intensity_perc;
        }
        intensityEventManager.subscribe(this._port, this._intensityChanged);

        this._stateChanged = function ({ play_state, play_state_name }) {
            instance._state.play_state = play_state;
            instance._state.play_state_name = play_state_name;
        }
        playStateEventManager.subscribe(this._port, this._stateChanged);


        this._patternChanged = function (pattern) {
            instance._currentPattern.value = pattern;
        }
        currentPatternEventManager.subscribe(this._port, this._patternChanged);

        this._debugEventHandler = function (data) {
            if (data.indexOf('Firmware') >= 0) {
                instance.version.value = data.substring(data.indexOf(' v')).replace('\n\x00', '');
                return;
            }
            if (data.indexOf('Vcap=') >= 0) {  //Iprim=0 mA, Vcap=2030 mV, Vbat=8345 mV
                var vc = data.substring(data.indexOf('Vcap=') + 5);
                instance._vcap.value = vc.substring(0, vc.indexOf('mV')).trim();
                instance._vbat.value = data.substr(data.indexOf('Vbat=') + 5, 5).trim()
            }
        }


        debugEventManager.subscribe(this._port, this._debugEventHandler);

        this.id = 'neodk';

        this.state = computed(() => {
            return this._state.play_state_name;
        });

        this.paused = computed(() => {
            return this.state.value != 'playing';
        });

        this.intensity = computed(() => {
            return this._intensityPercent.value;
        });
        this.currentPattern = computed(() => {
            return this._currentPattern.value;
        });
        this.vcap = computed(() => {
            return this._vcap.value;
        });
        this.vbat = computed(() => {
            return this._vbat.value;
        });

        this.readVersion();
    }

    static browserSupported() { return 'serial' in navigator; }
    static async selectPort() {
        var port = await selectPort();
        return new NeoDK({ port: port });
    }

    sendCommand(command) {
        return sendCommand(command, this._port);
    }

    readVersion() {
        return this.sendCommand("/v");
    }

}

export { NeoDK };

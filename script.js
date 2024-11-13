import { NeoDK } from './neostim.js';
import { createApp } from 'vue';


const app = createApp({
    data() {
        return {
            isBrowserSupported: NeoDK.browserSupported(),
            devices: []
        };
    },
    methods: {
        async connect() {
            try {
                var device = await NeoDK.selectPort();
                this.devices.push(device);
            } catch (error) {
                alert('Connect failed:' + error);
            }
        },
        async refreshState() {
            try {
                this.devices.forEach(element => {
                    element.sendCommand('/a');
                });
                setTimeout(this.refreshState, 1000);
            } catch (error) {
                console.error('Failed to fetch state', error);
            }
        }
    },
    mounted() {
        if (this.isBrowserSupported) {
            this.refreshState();
        }
    }
});

app.mount('#app');


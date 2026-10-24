import {defineConfig} from 'vite';
export default defineConfig({base:'./',worker:{format:'es'},build:{outDir:'dist-worker-slice',rollupOptions:{input:'worker-slice.html'}}});

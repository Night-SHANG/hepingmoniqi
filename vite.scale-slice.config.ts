import {defineConfig} from 'vite';
export default defineConfig({base:'./',worker:{format:'es'},build:{outDir:'dist-scale-slice',rollupOptions:{input:'scale-slice.html'}}});

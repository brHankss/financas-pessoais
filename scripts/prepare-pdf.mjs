import { copyFile, mkdir } from 'node:fs/promises';

const target = 'public/vendor/pdfjs';
await mkdir(target, { recursive: true });
for (const file of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
  await copyFile('node_modules/pdfjs-dist/legacy/build/' + file, target + '/' + file);
}
await copyFile('node_modules/pdfjs-dist/LICENSE', target + '/LICENSE');

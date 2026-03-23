const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const files = [
  { html: 'banner.html', png: 'banner.png', width: 1128, height: 191 },
  { html: 'post1-missing-layer.html', png: 'post1-missing-layer.png', width: 1200, height: 628 },
  { html: 'post2-engine.html', png: 'post2-engine.png', width: 1200, height: 628 },
  { html: 'post3-security-gap.html', png: 'post3-security-gap.png', width: 1200, height: 628 },
  { html: 'post4-scope.html', png: 'post4-scope.png', width: 1200, height: 628 },
];

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: '/usr/bin/google-chrome',
  });

  for (const file of files) {
    const page = await browser.newPage();
    const htmlPath = path.resolve(__dirname, file.html);

    await page.setViewport({ width: file.width, height: file.height, deviceScaleFactor: 2 });
    await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0', timeout: 10000 });

    // Wait for fonts to load
    await page.evaluate(() => document.fonts.ready);
    await new Promise(r => setTimeout(r, 1000));

    const outputPath = path.resolve(__dirname, file.png);
    await page.screenshot({ path: outputPath, type: 'png' });

    console.log(`Rendered: ${file.png} (${file.width}x${file.height})`);
    await page.close();
  }

  await browser.close();
  console.log('\nAll images rendered successfully!');
})();

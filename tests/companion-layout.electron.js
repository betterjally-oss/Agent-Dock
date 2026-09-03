const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

async function main() {
  await app.whenReady();
  const window = new BrowserWindow({
    width: 420,
    height: 220,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  try {
    await window.loadFile(path.join(__dirname, '..', 'renderer', 'companion.html'));
    window.webContents.send('companion:state', { state: 'rest', message: '', notchHeight: 38 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const layout = await window.webContents.executeJavaScript(`(() => {
      const cat = document.querySelector('.cat-rest');
      const catRect = cat.getBoundingClientRect();
      const pocketRect = document.querySelector('.sleep-pocket').getBoundingClientRect();
      const dreamRect = document.querySelector('.dream-marks').getBoundingClientRect();
      return {
        catTop: catRect.top,
        catBottom: catRect.bottom,
        catHeight: Number.parseFloat(getComputedStyle(cat).height),
        catCenterX: catRect.left + catRect.width / 2,
        dreamCenterX: dreamRect.left + dreamRect.width / 2,
        pocketTop: pocketRect.top,
        pocketBottom: pocketRect.bottom,
        animationName: getComputedStyle(cat).animationName,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        raster: cat instanceof HTMLImageElement && cat.currentSrc.endsWith('/cat-sleep.png'),
        loaded: cat.naturalWidth > 0,
        notchHeight: 38,
      };
    })()`);
    assert.ok(
      layout.catBottom >= layout.notchHeight + 24,
      `sleeping cat must remain visible below the physical notch: ${JSON.stringify(layout)}`
    );
    assert.ok(
      layout.pocketTop <= layout.notchHeight && layout.pocketBottom >= layout.catBottom,
      `sleeping cat must remain inside the extended island pocket: ${JSON.stringify(layout)}`
    );
    assert.equal(layout.animationName, layout.reducedMotion ? 'none' : 'sleepy-life');
    assert.ok(Math.abs(layout.catHeight - 48) < 1, JSON.stringify(layout));
    assert.equal(layout.raster, true);
    assert.equal(layout.loaded, true);
    assert.ok(
      layout.dreamCenterX < layout.catCenterX,
      `dream marks must float beside the cat's head, not its tail: ${JSON.stringify(layout)}`
    );

    window.webContents.send('companion:state', { state: 'focus', message: '', notchHeight: 38 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const focusLayout = await window.webContents.executeJavaScript(`(() => {
      const cat = document.querySelector('.cat-swing');
      const catRect = cat.getBoundingClientRect();
      const style = getComputedStyle(document.querySelector('.swing-stage'));
      return {
        catWidth: catRect.width,
        catHeight: Number.parseFloat(getComputedStyle(cat).height),
        raster: cat instanceof HTMLImageElement && cat.currentSrc.endsWith('/cat-swing.png'),
        loaded: cat.naturalWidth > 0,
        animationName: style.animationName,
        animationDuration: style.animationDuration,
        animationIterationCount: style.animationIterationCount,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      };
    })()`);
    assert.ok(focusLayout.catWidth > 0 && Math.abs(focusLayout.catHeight - 48) < 1);
    assert.equal(focusLayout.raster, true);
    assert.equal(focusLayout.loaded, true);
    assert.equal(focusLayout.animationName, focusLayout.reducedMotion ? 'none' : 'focus-swing');
    if (!focusLayout.reducedMotion) {
      assert.equal(focusLayout.animationDuration, '4s');
      assert.equal(focusLayout.animationIterationCount, 'infinite');
    }

    window.webContents.send('companion:state', { state: 'peek', message: '', notchHeight: 38 });
    await new Promise((resolve) => setTimeout(resolve, 900));
    const peekLayout = await window.webContents.executeJavaScript(`(() => {
      const cat = document.querySelector('.cat-peek');
      const catRect = cat.getBoundingClientRect();
      const coverRect = document.querySelector('.peek-cover').getBoundingClientRect();
      const style = getComputedStyle(document.querySelector('.peek-stage'));
      return {
        raster: cat instanceof HTMLImageElement && cat.currentSrc.endsWith('/cat-peek.png'),
        loaded: cat.naturalWidth > 0,
        catCenterX: catRect.left + catRect.width / 2,
        catHeight: Number.parseFloat(getComputedStyle(cat).height),
        coverLeft: coverRect.left,
        catBottom: catRect.bottom,
        coverBottom: coverRect.bottom,
        animationName: style.animationName,
        animationDuration: style.animationDuration,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      };
    })()`);
    assert.equal(peekLayout.raster, true);
    assert.equal(peekLayout.loaded, true);
    assert.ok(Math.abs(peekLayout.catHeight - 48) < 1, JSON.stringify(peekLayout));
    assert.ok(
      Math.abs(peekLayout.catCenterX - peekLayout.coverLeft) < 12,
      JSON.stringify(peekLayout)
    );
    assert.ok(peekLayout.coverBottom <= 38 && peekLayout.catBottom > 38);
    assert.equal(peekLayout.animationName, peekLayout.reducedMotion ? 'none' : 'peek-route');
    if (!peekLayout.reducedMotion) assert.equal(peekLayout.animationDuration, '6.4s');

    window.webContents.send('companion:state', { state: 'zipline', message: '', notchHeight: 38 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const removedZipline = await window.webContents.executeJavaScript(`(() => ({
      state: document.querySelector('#companion').dataset.state,
      hasZipline: Boolean(document.querySelector('.zipline-rider, .cat-zipline')),
    }))()`);
    assert.deepEqual(removedZipline, { state: 'hidden', hasZipline: false });

    window.webContents.send('companion:state', { state: 'celebrate', message: '做得好！', notchHeight: 38 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const celebration = await window.webContents.executeJavaScript(`(() => ({
      raster: document.querySelector('.cat-celebrate') instanceof HTMLImageElement,
      loaded: document.querySelector('.cat-celebrate').naturalWidth > 0,
      catHeight: Number.parseFloat(getComputedStyle(document.querySelector('.cat-celebrate')).height),
      animationName: getComputedStyle(document.querySelector('.cat-celebrate')).animationName,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      quote: document.querySelector('#companion-quote').textContent,
    }))()`);
    assert.equal(celebration.raster, true);
    assert.equal(celebration.loaded, true);
    assert.ok(Math.abs(celebration.catHeight - 48) < 1, JSON.stringify(celebration));
    assert.equal(celebration.animationName, celebration.reducedMotion ? 'none' : 'celebrate-bob');
    assert.equal(celebration.quote, '做得好！');
  } finally {
    window.destroy();
    app.quit();
  }
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const isolatedUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'to-do-panel-electron-test-'));
app.setPath('userData', isolatedUserData);
app.once('will-quit', () => fs.rmSync(isolatedUserData, { recursive: true, force: true }));

async function main() {
  await app.whenReady();
  const window = new BrowserWindow({
    width: 200,
    height: 38,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      // 与生产主窗口一致，避免 macOS 将重复运行的测试窗口判为遮挡后暂停 rAF。
      backgroundThrottling: false,
    },
  });

  try {
    await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    const freshProfileClipboardState = await window.webContents.executeJavaScript(`
      (() => ({
        history: localStorage.getItem('notch-clip-history'),
        favorites: localStorage.getItem('notch-clip-favorites'),
        imageRows: document.querySelectorAll('#clip-list [data-type="image"]').length,
      }))()
    `);
    assert.deepEqual(freshProfileClipboardState, {
      history: null,
      favorites: null,
      imageRows: 0,
    }, '全新用户目录不得预置任何剪贴板文本、收藏或图片记录');

    await window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    window.show();
    window.focus();
    window.webContents.focus();
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    const focusStyle = await window.webContents.executeJavaScript(`
      (async () => {
        const notch = document.getElementById('notch');
        const deadline = performance.now() + 5000;
        let result;
        do {
          const notchStyle = getComputedStyle(notch);
          const dotStyle = getComputedStyle(notch.querySelector('.notch-dot'));
          result = {
            active: document.activeElement === notch,
            focusVisible: notch.matches(':focus-visible'),
            outlineStyle: notchStyle.outlineStyle,
            outlineWidth: notchStyle.outlineWidth,
            dotBoxShadow: dotStyle.boxShadow,
          };
          if (result.active && result.focusVisible) return result;
          await new Promise((resolve) => setTimeout(resolve, 20));
        } while (performance.now() < deadline);
        return result;
      })()
    `);

    assert.equal(focusStyle.active, true, '折叠条应能通过键盘获得焦点');
    assert.equal(focusStyle.focusVisible, true, '键盘焦点应保持可见提示');
    assert.equal(
      focusStyle.outlineStyle,
      'none',
      `折叠外壳不能画焦点描边，当前为 ${focusStyle.outlineWidth} ${focusStyle.outlineStyle}`
    );
    assert.notEqual(focusStyle.dotBoxShadow, 'none', '焦点提示应转移到中间抓握条');

    const collapsedPanelLayers = await window.webContents.executeJavaScript(`
      (() => {
        const panel = document.querySelector('.panel');
        return {
          contentClipPath: getComputedStyle(panel).clipPath,
          shellClipPath: getComputedStyle(panel, '::before').clipPath,
        };
      })()
    `);
    assert.equal(
      collapsedPanelLayers.contentClipPath,
      'none',
      '折叠动效不得裁剪承载全部组件的内容层'
    );
    assert.notEqual(
      collapsedPanelLayers.shellClipPath,
      'none',
      '折叠轮廓应由独立背景外壳承担'
    );

    window.setSize(1240, 616);
    const topbarBlankToggle = await window.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const waitForClass = async (name) => {
          const deadline = performance.now() + 5000;
          while (performance.now() < deadline) {
            if (document.getElementById('app').classList.contains(name)) return true;
            await sleep(10);
          }
          return false;
        };
        // 生产默认开启超过四个 Tab，会进入左右分栏并让容器横跨整条顶栏。
        document.getElementById('tabs').classList.add('is-split');
        document.getElementById('notch').click();
        const opened = await waitForClass('expanded');
        const topbar = document.querySelector('.topbar').getBoundingClientRect();
        const x = topbar.left + topbar.width / 2;
        const y = topbar.top + topbar.height / 2;
        const hitTarget = document.elementFromPoint(x, y);
        const interceptedByTabs = Boolean(hitTarget?.closest('.tabs'));
        hitTarget?.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
        }));
        const collapsed = await waitForClass('collapsed');
        return {
          opened,
          collapsed,
          interceptedByTabs,
          hitTarget: hitTarget?.id || hitTarget?.className || hitTarget?.tagName || '',
          appClass: document.getElementById('app').className,
          panelAriaHidden: document.querySelector('.panel').getAttribute('aria-hidden'),
        };
      })()
    `);
    assert.equal(topbarBlankToggle.opened, true, '折叠岛点击后必须展开');
    assert.equal(
      topbarBlankToggle.interceptedByTabs,
      false,
      `顶部中央空白不得被 Tab 容器截获，当前命中 ${topbarBlankToggle.hitTarget}`
    );
    assert.equal(
      topbarBlankToggle.collapsed,
      true,
      `展开后点击顶部中央空白必须收起；最终状态 ${topbarBlankToggle.appClass} / aria-hidden=${topbarBlankToggle.panelAriaHidden}`
    );

    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
    const workbenchCatEdge = await window.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        document.getElementById('notch').click();
        const deadline = performance.now() + 2000;
        const cat = document.getElementById('workbench-cat');
        while ((!cat.dataset.edgeModule || cat.hidden) && performance.now() < deadline) await sleep(20);
        const tile = document.querySelector('[data-home-module="' + cat.dataset.edgeModule + '"]');
        const startTile = document.querySelector('[data-home-module="' + cat.dataset.routeStartModule + '"]');
        const endTile = document.querySelector('[data-home-module="' + cat.dataset.routeEndModule + '"]');
        const catRect = cat.getBoundingClientRect();
        const tileRect = tile.getBoundingClientRect();
        const startRect = startTile.getBoundingClientRect();
        const endRect = endTile.getBoundingClientRect();
        const crossedModules = [...document.querySelectorAll('#home-bento [data-home-module]:not([hidden])')]
          .filter((item) => Math.abs(item.getBoundingClientRect().top - startRect.top) < 2).length;
        const module = cat.dataset.edgeModule;
        const routeStartModule = cat.dataset.routeStartModule;
        const routeEndModule = cat.dataset.routeEndModule;
        const routeDirection = cat.dataset.direction;
        const movement = cat.getAnimations().find((animation) => animation.effect?.target === cat);
        movement.finish();
        await sleep(240);
        const secondStartTile = document.querySelector('[data-home-module="' + cat.dataset.routeStartModule + '"]');
        const secondEndTile = document.querySelector('[data-home-module="' + cat.dataset.routeEndModule + '"]');
        const secondStartRect = secondStartTile.getBoundingClientRect();
        const secondEndRect = secondEndTile.getBoundingClientRect();
        const secondRoute = {
          direction: cat.dataset.direction,
          top: secondStartRect.top,
          sameRow: Math.abs(secondStartRect.top - secondEndRect.top) < 2,
          rightToLeft: secondStartRect.left > secondEndRect.left,
          crossedModules: [...document.querySelectorAll('#home-bento [data-home-module]:not([hidden])')]
            .filter((item) => Math.abs(item.getBoundingClientRect().top - secondStartRect.top) < 2).length,
        };
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          bubbles: true,
          cancelable: true,
        }));
        while (!document.getElementById('app').classList.contains('collapsed')
          && performance.now() < deadline) await sleep(20);
        return {
          module,
          routeStartModule,
          routeEndModule,
          routeDirection,
          routeTopDelta: Math.abs(startRect.top - endRect.top),
          routeLeftToRight: startRect.left < endRect.left,
          crossedModules,
          firstRouteTop: startRect.top,
          secondRoute,
          width: catRect.width,
          height: catRect.height,
          pawOffset: catRect.bottom - tileRect.top,
          pointerEvents: getComputedStyle(cat).pointerEvents,
        };
      })()
    `);
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    assert.ok(workbenchCatEdge.module, '小猫必须取得一个可见面板的边缘');
    assert.ok(workbenchCatEdge.routeStartModule && workbenchCatEdge.routeEndModule, '小猫路线必须覆盖整排面板');
    assert.ok(workbenchCatEdge.routeTopDelta < 2, '小猫路线两端必须位于同一排');
    assert.equal(workbenchCatEdge.routeDirection, 'right', '展开工作台时必须先从上排左侧向右走');
    assert.equal(workbenchCatEdge.routeLeftToRight, true, '上排路线必须从第一个面板走向最后一个面板');
    assert.ok(workbenchCatEdge.crossedModules >= 2, '上排路线必须连续跨过整排面板');
    assert.equal(workbenchCatEdge.secondRoute.direction, 'left', '第二段必须从下排右侧向左走');
    assert.equal(workbenchCatEdge.secondRoute.sameRow, true, '第二段路线两端必须位于同一排');
    assert.equal(workbenchCatEdge.secondRoute.rightToLeft, true, '下排路线必须从第三个面板返回第一个面板');
    assert.ok(workbenchCatEdge.secondRoute.crossedModules >= 2, '下排路线必须连续跨过整排面板');
    assert.ok(workbenchCatEdge.secondRoute.top > workbenchCatEdge.firstRouteTop, '第二段路线必须位于下排');
    assert.equal(workbenchCatEdge.width, 74);
    assert.equal(workbenchCatEdge.height, 48);
    assert.ok(Math.abs(workbenchCatEdge.pawOffset) < 1, `小猫脚掌必须贴住面板上边缘：${workbenchCatEdge.pawOffset}`);
    assert.equal(workbenchCatEdge.pointerEvents, 'none');

    const topbarTabAndSpaceToggle = await window.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const waitForClass = async (name) => {
          const deadline = performance.now() + 5000;
          while (performance.now() < deadline) {
            if (document.getElementById('app').classList.contains(name)) return true;
            await sleep(10);
          }
          return false;
        };
        document.getElementById('notch').click();
        const opened = await waitForClass('expanded');
        const todoButton = document.getElementById('tab-button-todo');
        const rect = todoButton.getBoundingClientRect();
        const hitTarget = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        hitTarget?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await sleep(30);
        const todoActivated = document.getElementById('tab-todo').classList.contains('active');
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          bubbles: true,
          cancelable: true,
        }));
        const collapsedBySpace = await waitForClass('collapsed');
        return {
          opened,
          todoActivated,
          tabHit: Boolean(hitTarget?.closest('#tab-button-todo')),
          collapsedBySpace,
        };
      })()
    `);
    assert.equal(topbarTabAndSpaceToggle.opened, true);
    assert.equal(topbarTabAndSpaceToggle.tabHit, true, '空白穿透不得破坏真实 Tab 的点击命中');
    assert.equal(topbarTabAndSpaceToggle.todoActivated, true, '真实 Tab 点击必须继续切换页面');
    assert.equal(topbarTabAndSpaceToggle.collapsedBySpace, true, '展开后 Space 必须继续收起');

    window.setSize(1240, 616);
    const settingsSurface = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const appSurface = document.getElementById('app');
        appSurface.classList.remove('collapsed');
        appSurface.classList.add('expanded');
        document.getElementById('tab-button-settings').click();
        setTimeout(() => {
          const page = document.getElementById('settings-page');
          const panel = document.querySelector('.panel');
          const secondary = page.querySelector('.settings-column-secondary');
          const deviceCard = page.querySelector('.settings-device-card');
          secondary.scrollTop = secondary.scrollHeight;
          const secondaryRect = secondary.getBoundingClientRect();
          const deviceRect = deviceCard.getBoundingClientRect();
          const shellClipPath = getComputedStyle(panel, '::before').clipPath;
          resolve({
            contentClipPath: getComputedStyle(panel).clipPath,
            shellOwnsExpandedOutline: shellClipPath !== 'none' && !shellClipPath.includes('calc'),
            rightmostTab: document.querySelector('.tab[data-tab]:last-of-type')?.dataset.tab,
            activePanel: document.getElementById('tab-settings')?.classList.contains('active'),
            display: getComputedStyle(page).display,
            columns: getComputedStyle(page).gridTemplateColumns.split(' ').filter(Boolean).length,
            api: Boolean(document.getElementById('settings-api-configure')),
            agentSources: Boolean(document.getElementById('settings-agent-source-list')),
            legacyImport: Boolean(document.getElementById('settings-import-legacy')),
            features: document.querySelectorAll('[data-settings-feature]').length,
            homeModules: document.querySelectorAll('[data-settings-home-module]').length,
            shortcut: Boolean(document.getElementById('settings-shortcut-change')),
            workspace: Boolean(document.getElementById('settings-workspace-choose')),
            autoLaunch: Boolean(document.getElementById('settings-auto-launch')),
            companion: Boolean(document.getElementById('settings-companion-enabled')),
            quit: Boolean(document.getElementById('settings-quit-app')),
            scroll: {
              overflowY: getComputedStyle(secondary).overflowY,
              range: secondary.scrollHeight - secondary.clientHeight,
              top: secondary.scrollTop,
              bottomInset: secondaryRect.bottom - deviceRect.bottom,
            },
          });
        }, 80);
      })
    `);

    const settingsScroll = settingsSurface.scroll;
    delete settingsSurface.scroll;
    assert.deepEqual(settingsSurface, {
      contentClipPath: 'none',
      shellOwnsExpandedOutline: true,
      rightmostTab: 'settings',
      activePanel: true,
      display: 'grid',
      columns: 2,
      api: true,
      agentSources: true,
      legacyImport: true,
      features: 4,
      homeModules: 6,
      shortcut: true,
      workspace: true,
      autoLaunch: true,
      companion: true,
      quit: true,
    });
    assert.equal(
      settingsScroll.overflowY,
      'auto',
      `设置页右栏必须允许纵向滚动：${JSON.stringify(settingsScroll)}`
    );
    assert.ok(settingsScroll.range > 0, '设置页右栏内容超高时必须产生滚动范围');
    assert.ok(settingsScroll.top > 0, '设置页右栏必须能滚动到底部设置');
    assert.ok(settingsScroll.bottomInset >= 8, '最后一项设置与面板底边必须保留安全间距');

    const todoCalendarNavigation = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        document.getElementById('tab-button-todo').click();
        const trigger = document.querySelector('.todo-deadline-trigger[data-deadline-priority="P0"]');
        trigger.click();
        const previous = document.getElementById('todo-calendar-previous');
        const next = document.getElementById('todo-calendar-next');
        if (!previous || !next) {
          resolve({ controls: false });
          return;
        }
        const base = new Date(trigger.dataset.deadline || Date.now());
        const popover = document.getElementById('todo-date-popover');
        const previousRect = previous.getBoundingClientRect();
        const nextRect = next.getBoundingClientRect();
        const clicksToJanuary = 12 - base.getMonth();
        for (let index = 0; index < clicksToJanuary; index += 1) next.click();
        const expectedYear = base.getFullYear() + 1;
        const januaryLabel = document.getElementById('todo-editor-month').textContent.trim();
        const day = [...document.querySelectorAll('#todo-calendar-grid [data-day]')]
          .find((button) => button.dataset.day === '2');
        day.click();
        const selected = new Date(trigger.dataset.deadline);
        previous.click();
        resolve({
          controls: true,
          popoverVisible: !popover.hidden && getComputedStyle(popover).display !== 'none',
          controlsUsable: [previousRect.width, previousRect.height, nextRect.width, nextRect.height]
            .every((size) => size >= 18),
          januaryLabel,
          decemberLabel: document.getElementById('todo-editor-month').textContent.trim(),
          selected: [selected.getFullYear(), selected.getMonth(), selected.getDate()],
          baseYear: base.getFullYear(),
          expectedYear,
        });
      })
    `);

    const calendarExpectedYear = todoCalendarNavigation.baseYear + 1;
    assert.deepEqual(todoCalendarNavigation, {
      controls: true,
      popoverVisible: true,
      controlsUsable: true,
      januaryLabel: `${calendarExpectedYear}年 1月`,
      decemberLabel: `${calendarExpectedYear - 1}年 12月`,
      selected: [calendarExpectedYear, 0, 2],
      baseYear: calendarExpectedYear - 1,
      expectedYear: calendarExpectedYear,
    });

    await window.webContents.executeJavaScript(`
      window.__measureHomepage = function measureHomepage() {
        const surface = document.getElementById('home-bento').getBoundingClientRect();
        const protectedSelectors = {
          'agent-status': ['.agent-widget-head', '.agent-state-summary', '.agent-source-strip'],
          pomodoro: ['.pomodoro-readout', '.pomodoro-toggle', '.pomodoro-reset:not([hidden])'],
          recorder: ['.recorder-head', '.quick-brief-text', '.recorder-controls'],
          'attention-center': ['.agent-widget-head', '.attention-list'],
          'result-inbox': ['.agent-widget-head', '.agent-result-list'],
          note: ['.note-toolbar', '.note-context', '.note-body'],
        };
        const tiles = [...document.querySelectorAll('#home-bento [data-home-module]')]
          .filter((tile) => !tile.hidden)
          .map((tile) => {
            const rect = tile.getBoundingClientRect();
            const style = getComputedStyle(tile);
            const regions = (protectedSelectors[tile.dataset.homeModule] || [])
              .map((selector) => tile.querySelector(selector))
              .filter(Boolean)
              .map((node) => {
                const region = node.getBoundingClientRect();
                return { left: region.left, top: region.top, right: region.right, bottom: region.bottom };
              })
              .filter((region) => region.right > region.left && region.bottom > region.top);
            const outsideControls = [...tile.querySelectorAll('button:not([hidden]), input:not([hidden]), textarea:not([hidden])')]
              .filter((control) => {
                const child = control.getBoundingClientRect();
                return child.width > 0 && child.height > 0 && !(
                  child.left >= rect.left - 1 && child.right <= rect.right + 1
                  && child.top >= rect.top - 1 && child.bottom <= rect.bottom + 1
                );
              })
              .map((control) => {
                const controlRect = control.getBoundingClientRect();
                return {
                  name: control.id || control.className || control.tagName,
                  rect: { left: controlRect.left, top: controlRect.top, right: controlRect.right, bottom: controlRect.bottom },
                };
              });
            return {
              id: tile.dataset.homeModule,
              rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
              layoutRow: tile.dataset.layoutRow,
              borderTopWidth: Number.parseFloat(style.borderTopWidth),
              controlsInside: outsideControls.length === 0,
              outsideControls,
              variant: tile.dataset.layoutVariant,
              area: Number(tile.dataset.layoutWidth) * Number(tile.dataset.layoutHeight),
              regions,
            };
          });
        return {
          surface: { left: surface.left, top: surface.top, right: surface.right, bottom: surface.bottom },
          tiles,
          sizeControls: [...document.querySelectorAll('#home-bento [data-widget-size-cycle]')].map((control) => ({
            hidden: control.hidden,
            disabled: control.disabled,
            tabIndex: control.tabIndex,
            size: control.dataset.currentSize,
          })),
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          ghostCount: document.querySelectorAll('.home-layout-ghost').length,
          animations: document.getElementById('home-bento').getAnimations().map((animation) => ({
            name: animation.animationName || '',
            playState: animation.playState,
            target: animation.effect?.target?.className || '',
            duration: animation.effect?.getTiming?.().duration,
          })),
        };
      };
      void 0;
    `);

    function assertHomepageMeasurement(measurement, visibleCount) {
      assert.equal(measurement.tiles.length, visibleCount);
      assert.equal(measurement.tiles.reduce((total, tile) => total + tile.area, 0), 48);
      const outside = measurement.tiles.filter((tile) => !tile.controlsInside)
        .map((tile) => `${tile.id}(${tile.variant}): ${JSON.stringify(tile.outsideControls)} tile=${JSON.stringify(tile.rect)}`);
      assert.deepEqual(outside, [], `组件控件必须保持在各自卡片内：${outside.join('; ')}`);
      assert.equal(measurement.reducedMotion, true);
      assert.equal(measurement.ghostCount, 0, '减弱动态效果时不得创建 Auto Layout ghost');
      assert.ok(
        measurement.animations.every((animation) => Number(animation.duration) <= 0.01),
        `减弱动态效果时不得创建有感布局动画：${JSON.stringify(measurement.animations)}`
      );
      measurement.tiles.forEach((tile) => {
        assert.ok(tile.rect.left >= measurement.surface.left - 1, `${tile.id} 越过首页左边界`);
        assert.ok(tile.rect.right <= measurement.surface.right + 1, `${tile.id} 越过首页右边界`);
        assert.ok(tile.rect.top >= measurement.surface.top - 1, `${tile.id} 越过首页上边界`);
        assert.ok(tile.rect.bottom <= measurement.surface.bottom + 1, `${tile.id} 越过首页下边界`);
        assert.ok(['mini', 'compact', 'wide', 'tall', 'full'].includes(tile.variant));
        for (let left = 0; left < tile.regions.length; left += 1) {
          for (let right = left + 1; right < tile.regions.length; right += 1) {
            const a = tile.regions[left];
            const b = tile.regions[right];
            const overlaps = a.left < b.right - 1 && a.right > b.left + 1
              && a.top < b.bottom - 1 && a.bottom > b.top + 1;
            assert.equal(overlaps, false, `${tile.id}(${tile.variant}) 的关键内容区域发生重叠：${JSON.stringify([a, b])}`);
          }
        }
      });
      for (let left = 0; left < measurement.tiles.length; left += 1) {
        for (let right = left + 1; right < measurement.tiles.length; right += 1) {
          const a = measurement.tiles[left].rect;
          const b = measurement.tiles[right].rect;
          const overlaps = a.left < b.right - 1 && a.right > b.left + 1
            && a.top < b.bottom - 1 && a.bottom > b.top + 1;
          assert.equal(overlaps, false, '首页组件矩形不得重叠');
        }
      }
      if (visibleCount < 6) {
        assert.ok(measurement.sizeControls.every((control) => control.hidden && control.disabled && control.tabIndex === -1));
      } else {
        assert.ok(measurement.sizeControls.every((control) => !control.hidden && !control.disabled && control.tabIndex === 0));
      }
      const pomodoro = measurement.tiles.find((tile) => tile.id === 'pomodoro');
      const rowPeer = measurement.tiles.find((tile) => tile.id !== 'pomodoro' && tile.layoutRow === pomodoro?.layoutRow);
      if (pomodoro && rowPeer) {
        assert.equal(
          pomodoro.borderTopWidth,
          rowPeer.borderTopWidth,
          '番茄钟的可见上边缘应与同排面板使用相同边框宽度'
        );
      }
    }

    for (const [width, height] of [[1240, 616], [1000, 576]]) {
      window.setSize(width, height);
      const matrix = await window.webContents.executeJavaScript(`
        (async () => {
          const ids = ['agent-status', 'pomodoro', 'recorder', 'attention-center', 'result-inbox', 'note'];
          ids.forEach((id) => window.NotchHome.setModuleVisible(id, true));
          const results = [];
          for (let count = 6; count >= 1; count -= 1) {
            document.getElementById('tab-button-home').click();
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            results.push(window.__measureHomepage());
            if (count > 1) {
              document.getElementById('tab-button-settings').click();
              const input = document.querySelector('[data-settings-home-module="' + ids[6 - count] + '"]');
              input.checked = false;
              input.dispatchEvent(new Event('change', { bubbles: true }));
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
          }
          return results;
        })()
      `);
      matrix.forEach((measurement, index) => assertHomepageMeasurement(measurement, 6 - index));

      const recorderSeparation = await window.webContents.executeJavaScript(`
        (async () => {
          const ids = ['agent-status', 'pomodoro', 'recorder', 'attention-center', 'result-inbox', 'note'];
          ids.forEach((id) => window.NotchHome.setModuleVisible(id, true));
          document.getElementById('tab-button-home').click();
          const sizeButton = document.querySelector('[data-widget-size-cycle="recorder"]');
          for (let attempt = 0; attempt < 4 && sizeButton.dataset.currentSize !== 'large'; attempt += 1) {
            sizeButton.click();
          }
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const recorder = document.getElementById('home-recorder');
          recorder.dataset.layoutVariant = 'wide';
          const tile = recorder.getBoundingClientRect();
          const header = document.querySelector('.home-recorder .recorder-head').getBoundingClientRect();
          const text = document.getElementById('quick-brief-text').getBoundingClientRect();
          const controls = document.querySelector('.home-recorder .recorder-controls').getBoundingClientRect();
          const result = {
            gap: controls.top - text.bottom,
            topGap: text.top - header.bottom,
            leftInset: text.left - tile.left,
            rightInset: tile.right - text.right,
            widthRatio: text.width / tile.width,
            position: getComputedStyle(document.querySelector('.home-recorder .recorder-controls')).position,
            variant: document.getElementById('home-recorder').dataset.layoutVariant,
          };
          ids.forEach((id) => window.NotchHome.setModuleVisible(id, id === 'recorder'));
          return result;
        })()
      `);
      assert.ok(
        recorderSeparation.gap >= 6,
        `快速交代文本框与按钮栏必须保持间距：${JSON.stringify(recorderSeparation)}`
      );
      assert.ok(
        recorderSeparation.topGap >= 6
          && recorderSeparation.leftInset <= 20
          && recorderSeparation.rightInset <= 20
          && recorderSeparation.widthRatio >= .9,
        `快速交代输入框必须铺满标题与操作栏之间的内容区：${JSON.stringify(recorderSeparation)}`
      );

      const finalWidgetGuard = await window.webContents.executeJavaScript(`
        (async () => {
          document.getElementById('tab-button-settings').click();
          const enabled = [...document.querySelectorAll('[data-settings-home-module]')].find((input) => input.checked);
          enabled.checked = false;
          enabled.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 20));
          return {
            checked: enabled.checked,
            visibleCount: window.NotchHome.getVisibility().visibleIds.length,
            storedCount: JSON.parse(localStorage.getItem('notch-home-hidden-modules-v1')).length,
            message: document.getElementById('status-toast-message').textContent,
          };
        })()
      `);
      assert.equal(finalWidgetGuard.checked, true);
      assert.equal(finalWidgetGuard.visibleCount, 1);
      assert.equal(finalWidgetGuard.storedCount, 5);
      assert.match(finalWidgetGuard.message, /至少保留一个/);
    }

    const transactionAudit = await window.webContents.executeJavaScript(`
      (() => {
        const ids = ['agent-status', 'pomodoro', 'recorder', 'attention-center', 'result-inbox', 'note'];
        ids.forEach((id) => window.NotchHome.setModuleVisible(id, true));
        const first = window.NotchHome.setModuleVisible('result-inbox', false);
        const second = window.NotchHome.setModuleVisible('note', false);
        const rapidHidden = [...window.NotchHome.getVisibility().hiddenIds];
        ids.forEach((id) => window.NotchHome.setModuleVisible(id, true));
        window.NotchHome.setModuleVisible('pomodoro', false);
        window.NotchHome.setModuleVisible('pomodoro', true);
        window.NotchHome.setModuleVisible('pomodoro', false);
        let eventCount = 0;
        const onChange = () => { eventCount += 1; };
        document.addEventListener('notch:home-modules-changed', onChange);
        const storageBeforeNoop = localStorage.getItem('notch-home-hidden-modules-v1');
        const noop = window.NotchHome.setModuleVisible('pomodoro', false);
        const noOpStorageStable = storageBeforeNoop === localStorage.getItem('notch-home-hidden-modules-v1');
        document.removeEventListener('notch:home-modules-changed', onChange);
        const beforeRollback = {
          hidden: JSON.stringify(window.NotchHome.getVisibility().hiddenIds),
          stored: localStorage.getItem('notch-home-hidden-modules-v1'),
          visible: [...document.querySelectorAll('[data-home-module]')].filter((tile) => !tile.hidden).map((tile) => tile.dataset.homeModule).join(','),
          styles: [...document.querySelectorAll('[data-home-module]')].map((tile) => tile.getAttribute('style')).join('|'),
        };
        const originalResolver = window.NotchDomain.resolveHomeWidgetLayout;
        window.NotchDomain.resolveHomeWidgetLayout = () => null;
        const rollback = window.NotchHome.setModuleVisible('agent-status', false);
        window.NotchDomain.resolveHomeWidgetLayout = originalResolver;
        const afterRollback = {
          hidden: JSON.stringify(window.NotchHome.getVisibility().hiddenIds),
          stored: localStorage.getItem('notch-home-hidden-modules-v1'),
          visible: [...document.querySelectorAll('[data-home-module]')].filter((tile) => !tile.hidden).map((tile) => tile.dataset.homeModule).join(','),
          styles: [...document.querySelectorAll('[data-home-module]')].map((tile) => tile.getAttribute('style')).join('|'),
        };
        ids.forEach((id) => window.NotchHome.setModuleVisible(id, true));
        const originalWorkspace = window.NotchWorkspace;
        window.NotchWorkspace = { ...originalWorkspace, isRecordingActive: () => true };
        const quickBriefHideDuringRecording = window.NotchHome.setModuleVisible('recorder', false);
        window.NotchWorkspace = originalWorkspace;
        const durations = [];
        for (let index = 0; index < 100; index += 1) {
          const start = performance.now();
          window.NotchHome.setModuleVisible('note', index % 2 === 0 ? false : true);
          durations.push(performance.now() - start);
        }
        durations.sort((a, b) => a - b);
        return {
          first, second, rapidHidden, noop, eventCount,
          noOpStorageStable,
          rollback, rollbackStable: JSON.stringify(beforeRollback) === JSON.stringify(afterRollback),
          quickBriefHideDuringRecording,
          p95: durations[Math.floor(durations.length * .95)],
          maximum: durations[durations.length - 1],
          animationCount: document.getElementById('home-bento').getAnimations().length,
        };
      })()
    `);
    assert.equal(transactionAudit.first.ok, true);
    assert.equal(transactionAudit.second.ok, true);
    assert.deepEqual(transactionAudit.rapidHidden, ['result-inbox', 'note']);
    assert.equal(transactionAudit.noop.changed, false);
    assert.equal(transactionAudit.eventCount, 0);
    assert.equal(transactionAudit.noOpStorageStable, true);
    assert.equal(transactionAudit.rollback.error, 'layout_invalid');
    assert.equal(transactionAudit.rollbackStable, true);
    assert.equal(transactionAudit.quickBriefHideDuringRecording.ok, true);
    assert.ok(transactionAudit.p95 < 16, `显隐事务 p95 ${transactionAudit.p95.toFixed(2)}ms 超过 16ms`);
    assert.ok(transactionAudit.maximum < 50, `显隐事务最长 ${transactionAudit.maximum.toFixed(2)}ms 超过 50ms`);
    assert.ok(transactionAudit.animationCount <= 1);

    const persistenceAndRecorderAudit = await window.webContents.executeJavaScript(`
      (() => {
        const ids = ['agent-status', 'pomodoro', 'recorder', 'attention-center', 'result-inbox', 'note'];
        ids.forEach((id) => window.NotchHome.setModuleVisible(id, true));
        const originalSetItem = Storage.prototype.setItem;
        const storedBefore = localStorage.getItem('notch-home-hidden-modules-v1');
        Storage.prototype.setItem = function setItem(key, value) {
          if (key === 'notch-home-hidden-modules-v1') throw new Error('simulated quota failure');
          return originalSetItem.call(this, key, value);
        };
        const degraded = window.NotchHome.setModuleVisible('result-inbox', false);
        const degradedState = window.NotchHome.getVisibility();
        const degradedStatus = document.getElementById('settings-home-module-status').textContent;
        const degradedStorageStable = storedBefore === localStorage.getItem('notch-home-hidden-modules-v1');
        ['agent-status', 'pomodoro', 'recorder', 'attention-center'].forEach((id) => {
          window.NotchHome.setModuleVisible(id, false);
        });
        const rejectedWhileDirty = window.NotchHome.setModuleVisible('note', false);
        Storage.prototype.setItem = originalSetItem;
        const recovered = window.NotchHome.setModuleVisible('agent-status', true);
        const recoveredState = window.NotchHome.getVisibility();
        const recoveredStored = JSON.parse(localStorage.getItem('notch-home-hidden-modules-v1'));

        ids.forEach((id) => window.NotchHome.setModuleVisible(id, true));
        const originalWorkspace = window.NotchWorkspace;
        window.NotchWorkspace = { ...originalWorkspace, isRecordingActive: () => true };
        const recorderHidden = window.NotchHome.setModuleVisible('recorder', false);
        const recorderSwitch = document.querySelector('[data-settings-home-module="recorder"]');
        const hiddenSwitchEnabled = !recorderSwitch.disabled && !recorderSwitch.checked;
        const recorderRestored = window.NotchHome.setModuleVisible('recorder', true);
        const visibleSwitchEnabled = !recorderSwitch.disabled && recorderSwitch.checked;
        const recordingsActionAvailable = !document.getElementById('recording-new').disabled;
        window.NotchWorkspace = originalWorkspace;

        const noteInput = document.getElementById('home-note');
        noteInput.focus();
        const noteTile = noteInput.closest('[data-home-module]');
        window.NotchHome.setModuleVisible('note', false);
        const focusReleased = !noteTile.contains(document.activeElement)
          && noteTile.hidden
          && noteTile.querySelector('[data-widget-size-cycle]').tabIndex === -1;
        window.NotchHome.setModuleVisible('note', true);
        return {
          degraded,
          degradedPersisted: degradedState.persisted,
          degradedStorageStable,
          degradedStatus,
          rejectedWhileDirty,
          recovered,
          recoveredPersisted: recoveredState.persisted,
          recoveredStored,
          recorderHidden,
          hiddenSwitchEnabled,
          recorderRestored,
          visibleSwitchEnabled,
          recordingsActionAvailable,
          focusReleased,
        };
      })()
    `);
    assert.equal(persistenceAndRecorderAudit.degraded.ok, true);
    assert.equal(persistenceAndRecorderAudit.degraded.persisted, false);
    assert.equal(persistenceAndRecorderAudit.degradedPersisted, false);
    assert.equal(persistenceAndRecorderAudit.degradedStorageStable, true);
    assert.match(persistenceAndRecorderAudit.degradedStatus, /仅当前会话/);
    assert.equal(persistenceAndRecorderAudit.rejectedWhileDirty.ok, false);
    assert.equal(persistenceAndRecorderAudit.rejectedWhileDirty.persisted, false);
    assert.equal(persistenceAndRecorderAudit.recovered.ok, true);
    assert.equal(persistenceAndRecorderAudit.recovered.persisted, true);
    assert.equal(persistenceAndRecorderAudit.recoveredPersisted, true);
    assert.ok(Array.isArray(persistenceAndRecorderAudit.recoveredStored));
    assert.equal(persistenceAndRecorderAudit.recorderHidden.ok, true);
    assert.equal(persistenceAndRecorderAudit.hiddenSwitchEnabled, true);
    assert.equal(persistenceAndRecorderAudit.recorderRestored.ok, true);
    assert.equal(persistenceAndRecorderAudit.visibleSwitchEnabled, true);
    assert.equal(persistenceAndRecorderAudit.recordingsActionAvailable, true);
    assert.equal(persistenceAndRecorderAudit.focusReleased, true);

    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
    const panelMotionAudit = await window.webContents.executeJavaScript(`
      (async () => {
        const appSurface = document.getElementById('app');
        appSurface.classList.remove('expanded', 'opening', 'closing');
        appSurface.classList.add('collapsed');
        const waitForClass = async (name) => {
          const deadline = performance.now() + 5000;
          while (performance.now() < deadline) {
            if (appSurface.classList.contains(name)) return true;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          return false;
        };
        document.getElementById('notch').click();
        const opened = await waitForClass('expanded');
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const tileEntranceAnimations = [...document.querySelectorAll('#home-bento [data-home-module]')]
          .flatMap((tile) => tile.getAnimations())
          .filter((animation) => animation.animationName === 'bento-masonry-in').length;
        const contentLayerHasScale = [
          document.querySelector('.panel > .topbar'),
          document.querySelector('.panel > .panels'),
        ].filter(Boolean).some((layer) => layer.getAnimations().some((animation) => (
          animation.effect?.getKeyframes?.().some((frame) => {
            if (!frame.transform || frame.transform === 'none') return false;
            const matrix = new DOMMatrixReadOnly(frame.transform);
            const scaleX = Math.hypot(matrix.a, matrix.b);
            const scaleY = Math.hypot(matrix.c, matrix.d);
            return Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001;
          })
        )));
        const masonryReveal = document.getElementById('home-bento').classList.contains('masonry-reveal');
        document.getElementById('notch').click();
        const collapsed = await waitForClass('collapsed');
        return { opened, collapsed, tileEntranceAnimations, contentLayerHasScale, masonryReveal };
      })()
    `);
    assert.equal(panelMotionAudit.opened, true);
    assert.equal(panelMotionAudit.collapsed, true);
    assert.equal(panelMotionAudit.tileEntranceAnimations, 0, '展开时不得再同时启动六张卡片的错峰缩放入场');
    assert.equal(panelMotionAudit.masonryReveal, false, '首页卡片不应在每次展开时重播入场');
    assert.equal(panelMotionAudit.contentLayerHasScale, false, '展开/收起不应缩放整个大面积内容层');

    const lifecycleAudit = await window.webContents.executeJavaScript(`
      (async () => {
        const ids = ['agent-status', 'pomodoro', 'recorder', 'attention-center', 'result-inbox', 'note'];
        ids.forEach((id) => window.NotchHome.setModuleVisible(id, true));
        document.getElementById('tab-button-home').click();
        document.getElementById('app').classList.remove('collapsed', 'closing', 'opening');
        document.getElementById('app').classList.add('expanded');
        document.dispatchEvent(new CustomEvent('notch:modechange', { detail: { expanded: true } }));
        const minutes = document.getElementById('pomodoro-minutes');
        const seconds = document.getElementById('pomodoro-seconds');
        minutes.value = '00';
        seconds.value = '10';
        seconds.dispatchEvent(new Event('blur'));
        document.getElementById('pomodoro-toggle').click();
        const before = Number(minutes.value) * 60 + Number(seconds.value);
        window.NotchHome.setModuleVisible('pomodoro', false);
        await new Promise((resolve) => setTimeout(resolve, 1150));
        const whileHidden = Number(minutes.value) * 60 + Number(seconds.value);
        window.NotchHome.setModuleVisible('pomodoro', true);
        const after = Number(minutes.value) * 60 + Number(seconds.value);
        document.getElementById('pomodoro-reset').click();
        return {
          attentionCenterPresent: Boolean(document.getElementById('attention-list')),
          windowModuleRemoved: !document.getElementById('window-list'),
          legacyMediaRemoved: !document.getElementById('music-color-bends')
            && !document.getElementById('mirror-stage'),
          before,
          whileHidden,
          after,
        };
      })()
    `);
    assert.equal(lifecycleAudit.attentionCenterPresent, true);
    assert.equal(lifecycleAudit.windowModuleRemoved, true);
    assert.equal(lifecycleAudit.legacyMediaRemoved, true);
    assert.ok(lifecycleAudit.whileHidden < lifecycleAudit.before, '番茄钟隐藏后应继续计时');
    assert.equal(lifecycleAudit.after, lifecycleAudit.whileHidden);

    const idlePerformanceAudit = await window.webContents.executeJavaScript(`
      (async () => {
        const appSurface = document.getElementById('app');
        document.getElementById('tab-button-home').click();
        appSurface.classList.remove('collapsed');
        appSurface.classList.add('expanded');
        document.dispatchEvent(new CustomEvent('notch:modechange', { detail: { expanded: true } }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const legacyCanvasRemoved = !document.getElementById('music-color-bends');
        const hasInfinitePanelEffect = document.getElementById('panel').getAnimations({ subtree: true })
          .some((animation) => animation.animationName === 'bento-border-breathe'
            && animation.effect?.getTiming?.().iterations === Infinity);
        const panelBackdropFilter = getComputedStyle(document.getElementById('panel'), '::before').backdropFilter;
        appSurface.classList.remove('expanded');
        appSurface.classList.add('collapsed');
        document.dispatchEvent(new CustomEvent('notch:modechange', { detail: { expanded: false } }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        appSurface.classList.remove('collapsed');
        appSurface.classList.add('expanded');
        document.dispatchEvent(new CustomEvent('notch:modechange', { detail: { expanded: true } }));
        return {
          legacyCanvasRemoved,
          hasInfinitePanelEffect,
          panelBackdropFilter,
        };
      })()
    `);
    assert.equal(idlePerformanceAudit.legacyCanvasRemoved, true, '旧音乐 WebGL 画布必须移除');
    assert.equal(idlePerformanceAudit.hasInfinitePanelEffect, false, '展开后不得运行大面积无限边框滤镜动画');
    assert.equal(idlePerformanceAudit.panelBackdropFilter, 'none', '近乎不透明的面板不得使用大面积实时背景模糊');

    const attentionTodoRoutingAudit = await window.webContents.executeJavaScript(`
      (async () => {
        if (document.getElementById('panel').inert) {
          const expanded = new Promise((resolve) => document.addEventListener(
            'notch:modechange',
            resolve,
            { once: true }
          ));
          document.getElementById('notch').click();
          await expanded;
        }
        document.getElementById('tab-button-home').click();
        const beforeIds = new Set(window.NotchTodos.items().map((item) => item.id));
        const added = window.NotchTodos.addAgentResult('待处理定位测试', 'P2');
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const todo = window.NotchTodos.items().find((item) => !beforeIds.has(item.id));
        await window.NotchTodos.open(todo.id, todo.priority);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const target = todo ? document.querySelector('.todo-item[data-id="' + CSS.escape(todo.id) + '"]') : null;
        const result = {
          added,
          todoActive: document.getElementById('tab-todo').classList.contains('active'),
          targetFound: Boolean(target),
          highlighted: target?.classList.contains('attention-focus') || false,
          focused: target?.contains(document.activeElement) || false,
          activeElement: document.activeElement?.outerHTML?.slice(0, 240) || '',
          targetInert: target?.closest('[inert]')?.id || '',
        };
        const collapsed = new Promise((resolve) => document.addEventListener(
          'notch:modechange',
          resolve,
          { once: true }
        ));
        document.getElementById('notch').click();
        await collapsed;
        return result;
      })()
    `);
    assert.equal(attentionTodoRoutingAudit.added, true);
    assert.equal(attentionTodoRoutingAudit.todoActive, true, '本地待办仍应进入任务页');
    assert.equal(attentionTodoRoutingAudit.targetFound, true);
    assert.equal(attentionTodoRoutingAudit.highlighted, true, '应高亮待我处理中的具体任务');
    assert.equal(
      attentionTodoRoutingAudit.focused,
      true,
      `应把键盘焦点送到对应任务：${JSON.stringify(attentionTodoRoutingAudit)}`
    );

    const keyboardReorderAudit = await window.webContents.executeJavaScript(`
      (async () => {
        const ids = ['agent-status', 'pomodoro', 'recorder', 'attention-center', 'result-inbox', 'note'];
        ids.forEach((id) => window.NotchHome.setModuleVisible(id, true));
        const button = document.querySelector('[data-widget-size-cycle="agent-status"]');
        const tile = button.closest('[data-home-module]');
        const before = tile.style.order;
        button.focus();
        button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const after = tile.style.order;
        button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 260));
        return {
          before,
          after,
          restored: tile.style.order,
          shortcut: button.getAttribute('aria-keyshortcuts'),
        };
      })()
    `);
    assert.notEqual(keyboardReorderAudit.after, keyboardReorderAudit.before, 'Option + 方向键应重排首页模块');
    assert.equal(keyboardReorderAudit.restored, keyboardReorderAudit.before, '反向移动应恢复原顺序');
    assert.match(keyboardReorderAudit.shortcut, /Alt\+ArrowRight/);

    const keyboardResizeAudit = await window.webContents.executeJavaScript(`
      (async () => {
        const handle = document.querySelector('[data-widget-grid-resize="agent-status"]');
        const tile = handle.closest('[data-home-module]');
        const before = { width: tile.dataset.layoutWidth, height: tile.dataset.layoutHeight };
        handle.focus();
        handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 260));
        const wider = { width: tile.dataset.layoutWidth, height: tile.dataset.layoutHeight };
        const saved = JSON.parse(localStorage.getItem('notch-home-widget-sizes-v2'));
        const exactCover = [...document.querySelectorAll('#home-bento [data-home-module]:not([hidden])')]
          .reduce((area, item) => area + Number(item.dataset.layoutWidth) * Number(item.dataset.layoutHeight), 0);
        handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 260));
        return {
          before,
          wider,
          restored: { width: tile.dataset.layoutWidth, height: tile.dataset.layoutHeight },
          savedSize: saved['agent-status'],
          exactCover,
          shortcut: handle.getAttribute('aria-keyshortcuts'),
        };
      })()
    `);
    assert.equal(Number(keyboardResizeAudit.wider.width), Number(keyboardResizeAudit.before.width) + 1);
    assert.deepEqual(keyboardResizeAudit.restored, keyboardResizeAudit.before);
    assert.match(keyboardResizeAudit.savedSize, /^(?:mini|small|medium|large|\d+x\d)$/);
    assert.equal(keyboardResizeAudit.exactCover, 48, '缩放后首页必须无重叠、无空洞');
    assert.match(keyboardResizeAudit.shortcut, /ArrowRight/);

    const resizeHandlePositionAudit = await window.webContents.executeJavaScript(`
      [...document.querySelectorAll('#home-bento [data-home-module]:not([hidden])')].map((tile) => {
        const handle = tile.querySelector('[data-widget-grid-resize]');
        const tileRect = tile.getBoundingClientRect();
        const handleRect = handle.getBoundingClientRect();
        const style = getComputedStyle(handle);
        return {
          id: tile.dataset.homeModule,
          position: style.position,
          rightInset: Math.round(tileRect.right - handleRect.right),
          bottomInset: Math.round(tileRect.bottom - handleRect.bottom),
          inset: [style.top, style.right, style.bottom, style.left].join(' '),
          gridArea: [style.gridRowStart, style.gridColumnStart].join('/'),
          alignment: [style.alignSelf, style.justifySelf].join('/'),
        };
      })
    `);
    assert.deepEqual(
      resizeHandlePositionAudit.filter((item) => item.position !== 'absolute'
        || item.rightInset < 6 || item.rightInset > 12
        || item.bottomInset < 6 || item.bottomInset > 12),
      [],
      '所有缩放手柄都必须脱离内容布局并贴近右下角'
    );

    const autoLayoutMotionAudit = await window.webContents.executeJavaScript(`
      (async () => {
        const ids = ['agent-status', 'pomodoro', 'recorder', 'attention-center', 'result-inbox', 'note'];
        ids.forEach((id) => window.NotchHome.setModuleVisible(id, true));
        document.getElementById('tab-button-home').click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const sizeButton = document.querySelector('[data-widget-size-cycle="agent-status"]');
        const beforeSize = sizeButton.dataset.currentSize;
        sizeButton.click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const ghosts = [...document.querySelectorAll('.home-layout-ghost')];
        const tileAnimations = [...document.querySelectorAll('#home-bento [data-home-module]:not([hidden])')]
          .flatMap((tile) => tile.getAnimations());
        const tileDurations = tileAnimations
          .map((animation) => Number(animation.effect?.getTiming?.().duration) || 0)
          .filter((duration) => duration > 0);
        const animatedOpacities = tileAnimations.flatMap((animation) => (
          animation.effect?.getKeyframes?.().map((frame) => Number(frame.opacity)).filter(Number.isFinite) || []
        ));
        const minimumTileOpacity = animatedOpacities.length ? Math.min(...animatedOpacities) : 1;
        const realTileHasScale = [...document.querySelectorAll('#home-bento [data-home-module]:not([hidden])')]
          .some((tile) => tile.getAnimations().some((animation) => (
            animation.effect?.getKeyframes?.().some((frame) => /scale/.test(String(frame.transform || '')))
          )));
        const during = {
          beforeSize,
          afterSize: sizeButton.dataset.currentSize,
          ghostCount: ghosts.length,
          tileDurations,
          minimumTileOpacity,
          realTileHasScale,
        };
        await new Promise((resolve) => setTimeout(resolve, 700));
        const ghostsAfter = document.querySelectorAll('.home-layout-ghost').length;
        const tileAnimationsAfter = [...document.querySelectorAll('#home-bento [data-home-module]:not([hidden])')]
          .reduce((count, tile) => count + tile.getAnimations().length, 0);
        sizeButton.click();
        sizeButton.click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const rapidGhostIds = [...document.querySelectorAll('.home-layout-ghost')]
          .map((ghost) => ghost.dataset.homeLayoutGhost);
        const rapidDuplicateGhosts = new Set(rapidGhostIds).size !== rapidGhostIds.length;
        const rapidMaxTileAnimations = Math.max(...[...document.querySelectorAll('#home-bento [data-home-module]:not([hidden])')]
          .map((tile) => tile.getAnimations().length));
        await new Promise((resolve) => setTimeout(resolve, 700));
        return {
          ...during,
          ghostsAfter,
          tileAnimationsAfter,
          rapidDuplicateGhosts,
          rapidMaxTileAnimations,
          rapidGhostsAfter: document.querySelectorAll('.home-layout-ghost').length,
        };
      })()
    `);
    assert.notEqual(autoLayoutMotionAudit.afterSize, autoLayoutMotionAudit.beforeSize);
    assert.equal(autoLayoutMotionAudit.ghostCount, 0, '尺寸切换不得用空外壳遮成黑块');
    assert.ok(
      autoLayoutMotionAudit.tileDurations.length > 0
        && autoLayoutMotionAudit.tileDurations.every((duration) => duration >= 180 && duration <= 260),
      'Auto Layout 应在 220ms 左右快速落定'
    );
    assert.ok(autoLayoutMotionAudit.minimumTileOpacity >= 0.72, '重排期间真实卡片不得熄灭成黑块');
    assert.equal(autoLayoutMotionAudit.realTileHasScale, true, '真实卡片应恢复连续 FLIP 几何过渡');
    assert.equal(autoLayoutMotionAudit.ghostsAfter, 0, 'Auto Layout ghost 必须在动画后清理');
    assert.equal(autoLayoutMotionAudit.tileAnimationsAfter, 0, '重排动画结束后不得残留组件动画');
    assert.equal(autoLayoutMotionAudit.rapidDuplicateGhosts, false, '连续切换必须先清理上一轮 Auto Layout ghost');
    assert.ok(autoLayoutMotionAudit.rapidMaxTileAnimations <= 1, '连续切换不得叠加多轮组件动画');
    assert.equal(autoLayoutMotionAudit.rapidGhostsAfter, 0, '连续切换结束后不得残留 Auto Layout ghost');
  } finally {
    if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach();
    window.destroy();
  }
}

main().then(
  () => app.quit(),
  (error) => {
    console.error(error);
    app.exit(1);
  }
);

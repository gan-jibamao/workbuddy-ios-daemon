/* ios-mobile.js —— iPhone 上的表格形态与配置页折叠。
 *
 * 面板每 5 秒整表重建（innerHTML），所以用 MutationObserver 持续打补丁，
 * 只写 class 与 data-label，不动 innerHTML、不碰事件绑定。
 *
 * 规则：
 *   表头 ≥ 6 列  -> as-cards（卡片）
 *   表头 1..5 列 -> fit（取消 640px 下限，压紧折行）
 *   没有表头     -> 不动（用量明细是动态表头，填充后会自动命中上面两条）
 */
(function () {
  var MQ = window.matchMedia('(max-width: 760px)');
  var CARD_MIN = 6;

  function heads(table) {
    var row = table.tHead && table.tHead.rows[0];
    if (!row) return null;
    var labels = [];
    for (var i = 0; i < row.cells.length; i++) {
      labels.push((row.cells[i].innerText || '').replace(/\s+/g, ' ').trim());
    }
    return labels;
  }

  function shape(table) {
    var labels = heads(table);
    if (!labels || !labels.length) {
      /* 用量明细是空壳表（表头等数据到了才填）：先按窄表收着，
         数据到达触发 mutation 后会自动重判成卡片。 */
      table.classList.remove('as-cards');
      table.classList.add('fit');
      return;
    }
    if (labels.length >= CARD_MIN) {
      table.classList.add('as-cards');
      table.classList.remove('fit');
      var bodies = table.tBodies;
      for (var b = 0; b < bodies.length; b++) {
        var rows = bodies[b].rows;
        for (var r = 0; r < rows.length; r++) {
          var tds = rows[r].cells;
          for (var c = 0; c < tds.length; c++) {
            if (!tds[c].dataset.label) tds[c].dataset.label = labels[c] || '';
          }
        }
      }
      return;
    }
    table.classList.remove('as-cards');
    table.classList.add('fit');
  }

  /* 配置页：八个分区折叠，默认只展开「服务」与「分域配置」。 */
  var STORE = 'wb_mobile_cfg_open';

  function openMap() {
    try {
      return JSON.parse(localStorage.getItem(STORE) || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function saveMap(m) {
    try {
      localStorage.setItem(STORE, JSON.stringify(m));
    } catch (e) {
      /* 隐私模式下写不进去，忽略 */
    }
  }

  function foldConfig() {
    var view = document.getElementById('view-config');
    if (!view || !MQ.matches) return;
    var boxes = view.querySelectorAll('.box');
    var saved = openMap();
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      var h3 = box.querySelector('header h3');
      if (!h3) continue;
      var key = (h3.innerText || '').trim().slice(0, 20);
      if (!box.dataset.key) box.dataset.key = key;
      var open = saved[key];
      if (open === undefined) open = i < 2; /* 默认只开前两个 */
      box.classList.toggle('collapsed', !open);
      if (!box.dataset.bound) {
        box.dataset.bound = '1';
        (function (b, k) {
          var hd = b.querySelector('header');
          if (!hd) return;
          hd.addEventListener('click', function (ev) {
            if (ev.target.closest('button, a, input, select')) return;
            var m = openMap();
            m[k] = b.classList.contains('collapsed');
            saveMap(m);
            b.classList.toggle('collapsed');
            ev.preventDefault();
          });
        })(box, key);
      }
    }
  }

  function sweep() {
    var tables = document.querySelectorAll('table');
    var i;
    if (!MQ.matches) {
      for (i = 0; i < tables.length; i++) {
        tables[i].classList.remove('as-cards');
        tables[i].classList.remove('fit');
      }
      return;
    }
    for (i = 0; i < tables.length; i++) shape(tables[i]);
    foldConfig();
  }

  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    (window.requestAnimationFrame || window.setTimeout)(function () {
      pending = false;
      sweep();
    }, 16);
  }

  function start() {
    sweep();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    if (MQ.addEventListener) MQ.addEventListener('change', sweep);
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.nav')) setTimeout(sweep, 60);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

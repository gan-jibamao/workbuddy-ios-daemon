/* ios-mobile.js —— 把列多的表格转成卡片所需的 data-label。
 *
 * 面板每 5 秒整表重建（innerHTML），所以这里用 MutationObserver 打补丁，
 * 而不是只在加载时跑一次。只写 data-label 与 class，不动 innerHTML 与事件。
 *
 * 阈值：表头 6 列及以上才转卡片；列少的仍然用表格（首列已由 CSS 冻结）。
 */
(function () {
  var MQ = window.matchMedia('(max-width: 760px)');
  var MIN_COLS = 6;

  function cardify(table) {
    var head = table.tHead && table.tHead.rows[0];
    if (!head) return;
    var cells = head.cells;
    if (cells.length < MIN_COLS) {
      table.classList.remove('as-cards');
      return;
    }
    var labels = [];
    for (var i = 0; i < cells.length; i++) {
      labels.push((cells[i].innerText || '').replace(/\s+/g, ' ').trim());
    }
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
    table.classList.add('as-cards');
  }

  function sweep() {
    var tables = document.querySelectorAll('table');
    var i;
    if (!MQ.matches) {
      for (i = 0; i < tables.length; i++) tables[i].classList.remove('as-cards');
      return;
    }
    for (i = 0; i < tables.length; i++) cardify(tables[i]);
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
    var obs = new MutationObserver(schedule);
    obs.observe(document.body, { childList: true, subtree: true });
    if (MQ.addEventListener) MQ.addEventListener('change', sweep);
    // 面板切视图是 display 切换，不触发 childList；顺手兜一层。
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

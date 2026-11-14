/* ios-mobile.js —— iPhone 上的表格形态与配置页折叠。
 *
 * 面板每 5 秒整表重建（innerHTML），并且会自主重载页面；
 * 所以用 MutationObserver 持续打补丁，只写 class / data-* 属性，不动 innerHTML。
 *
 * 形态判定：
 *   表头 >= 6 列  -> as-cards（两列网格卡片，第一列非装饰单元格当标题）
 *   表头 1..5 列  -> fit（取消 table.acc 的 640px 下限，压紧折行）
 *   空壳表（表头等数据） -> 先 fit，数据到了自动重判
 */
(function () {
  var MQ = window.matchMedia('(max-width: 760px)');
  var CARD_MIN = 5;
  /* 紧凑行里优先展示的字段 */
  var KEEP = /结果|状态|积分|额度|余额|模型|用量|次数|耗时|延时|数量/;
  var ROOT = document.documentElement;

  /* 全部移动样式挂在 html.ios-m 下：面板的 `.xs{height:28px}` 一类类选择器
     比裸标签特异性高，没有这一层压不住。面板重载后由这里补回来。 */
  function ensureScope() {
    if (!ROOT.classList.contains('ios-m')) ROOT.classList.add('ios-m');
  }
  ensureScope();

  function headLabels(table) {
    var row = table.tHead && table.tHead.rows[0];
    if (!row) return null;
    var out = [];
    for (var i = 0; i < row.cells.length; i++) {
      out.push((row.cells[i].innerText || '').replace(/\s+/g, ' ').trim());
    }
    return out;
  }

  function shape(table) {
    var labels = headLabels(table);
    if (!labels || labels.length < CARD_MIN) {
      table.classList.remove('as-cards');
      table.classList.remove('dense');
      table.classList.add('fit');
      return;
    }
    table.classList.add('as-cards');
    table.classList.remove('fit');
    /* 列特别多（请求事件 13 列、余额趋势 11 列）用三列网格，否则卡片太高 */
    table.classList.toggle('dense', labels.length >= 10);

    /* 行数多的时候卡片会把页面撑到几万像素：>12 行改用紧凑行，
       只保留关键字段，其余点开再看。 */
    var totalRows = 0;
    for (var tb = 0; tb < table.tBodies.length; tb++) totalRows += table.tBodies[tb].rows.length;
    var compact = totalRows > 12;
    table.classList.toggle('compact', compact);

    var bodies = table.tBodies;
    for (var b = 0; b < bodies.length; b++) {
      var rows = bodies[b].rows;
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var tds = row.cells;
        if (tds.length <= 1) {
          row.dataset.empty = '1';
          continue;
        }
        delete row.dataset.empty;
        var titleTaken = false;
        var kept = 0;
        for (var c = 0; c < tds.length; c++) {
          var td = tds[c];
          var role;
          if (td.classList.contains('mark') || td.classList.contains('c-mark')) {
            role = 'mark';
          } else if (td.classList.contains('c-acts')) {
            role = 'acts';
          } else if (!titleTaken) {
            role = 'title';
            titleTaken = true;
          } else {
            role = 'field';
          }
          td.dataset.role = role;
          if (role === 'field') {
            td.dataset.label = labels[c] || '';
            if (compact) {
              /* 一行只保留两个关键字段，多了就压成三行以上、页面立刻变长 */
              var keep = KEEP.test(td.dataset.label) && kept < 2;
              td.dataset.prio = keep ? 'keep' : 'more';
              if (keep) kept++;
            } else if (td.dataset.prio) {
              delete td.dataset.prio;
            }
          } else if (td.dataset.label) {
            delete td.dataset.label;
          }
        }
      }
    }
  }

  /* ── 配置页折叠 ─────────────────────────────────────────────── */
  var STORE = 'wb_mobile_cfg_open';

  function readOpen() {
    try {
      return JSON.parse(localStorage.getItem(STORE) || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function writeOpen(m) {
    try {
      localStorage.setItem(STORE, JSON.stringify(m));
    } catch (e) {
      /* 隐私模式写不进去，忽略 */
    }
  }

  function bindHeader(box, key) {
    var header = box.querySelector('header');
    if (!header) return;
    header.addEventListener('click', function (ev) {
      if (ev.target.closest('button, a, input, select, textarea')) return;
      var m = readOpen();
      var collapseNow = !box.classList.contains('collapsed');
      m[key] = !collapseNow;
      writeOpen(m);
      box.classList.toggle('collapsed', collapseNow);
      ev.preventDefault();
    });
  }

  function foldConfig() {
    var view = document.getElementById('view-config');
    if (!view) return;
    var boxes = view.querySelectorAll('.box');
    var saved = readOpen();
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      var h3 = box.querySelector('header h3');
      if (!h3) continue;
      var key = (h3.innerText || '').trim().slice(0, 24);
      var open = saved[key];
      if (open === undefined) open = i < 2; /* 默认只展开前两块 */
      box.classList.toggle('collapsed', !open);
      if (box.dataset.boundCfg === '1') continue;
      box.dataset.boundCfg = '1';
      bindHeader(box, key);
    }
  }

  /* ── 执行 ───────────────────────────────────────────────────── */
  function sweep() {
    ensureScope();
    var tables = document.querySelectorAll('table');
    var i, k;
    if (!MQ.matches) {
      for (i = 0; i < tables.length; i++) {
        tables[i].classList.remove('as-cards');
        tables[i].classList.remove('fit');
      }
      return;
    }
    for (i = 0; i < tables.length; i++) {
      shape(tables[i]);
      if (!tables[i].dataset.tapBound) {
        tables[i].dataset.tapBound = '1';
        tables[i].addEventListener('click', onRowClick);
      }
    }
    foldConfig();
  }

  /* 用 setTimeout 而不是 requestAnimationFrame：面板常被切到后台标签页，
     后台 rAF 会完全暂停，导致 pending 永久卡住、表格再也不打补丁。
     定时器在后台只是降频（约 1s 一次），不会停。 */
  function onRowClick(ev) {
    var table = ev.currentTarget;
    if (!table.classList.contains('compact')) return;
    if (ev.target.closest('button, a, input, select, textarea')) return;
    var row = ev.target.closest('tr');
    if (row) row.classList.toggle('open');
  }

  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    window.setTimeout(function () {
      pending = false;
      sweep();
    }, 30);
  }

  function start() {
    sweep();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    /* 面板重载或外部脚本改写 <html> 的 class 时补回作用域 */
    new MutationObserver(ensureScope).observe(ROOT, { attributes: true, attributeFilter: ['class'] });
    if (MQ.addEventListener) MQ.addEventListener('change', sweep);
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.nav')) setTimeout(sweep, 80);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

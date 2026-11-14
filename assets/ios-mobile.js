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
          } else if (td.classList.contains('c-acts') ||
                     (c === tds.length - 1 && td.querySelector('button'))) {
            /* 面板有些表把操作按钮放在没有 c-acts 类的最后一列 */
            role = 'acts';
          } else if (!titleTaken) {
            role = 'title';
            titleTaken = true;
          } else {
            role = 'field';
          }
          if (role === 'title' && compact) {
            /* 标题格里常是「时间<br>日期」，紧凑行里要拼成一行，补个分隔符 */
            var brs = td.querySelectorAll('br');
            for (var bi = 0; bi < brs.length; bi++) {
              brs[bi].replaceWith(document.createTextNode(' · '));
            }
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

  function readOpen(storeKey) {
    try {
      return JSON.parse(localStorage.getItem(STORE + '.' + (storeKey || 'cfg')) || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function writeOpen(m, storeKey) {
    try {
      localStorage.setItem(STORE + '.' + (storeKey || 'cfg'), JSON.stringify(m));
    } catch (e) {
      /* 隐私模式写不进去，忽略 */
    }
  }

  function bindHeader(box, key, storeKey) {
    var header = box.querySelector('header');
    if (!header) return;
    header.addEventListener('click', function (ev) {
      if (ev.target.closest('button, a, input, select, textarea')) return;
      var m = readOpen(storeKey);
      var collapseNow = !box.classList.contains('collapsed');
      m[key] = !collapseNow;
      writeOpen(m, storeKey);
      box.classList.toggle('collapsed', collapseNow);
      ev.preventDefault();
    });
  }

  /* 通用折叠：配置页八个分区、积分构成每个账号一块。
     默认只展开前两块，选择记到 localStorage。 */
  function foldBoxes(viewId, storeKey, defaultOpen) {
    var view = document.getElementById(viewId);
    if (!view) return;
    var boxes = view.querySelectorAll('.box');
    var saved = readOpen(storeKey);
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      var h3 = box.querySelector('header h3');
      if (!h3) continue;
      var key = (h3.innerText || '').trim().slice(0, 24);
      var open = saved[key];
      if (open === undefined) open = i < defaultOpen;
      box.classList.toggle('collapsed', !open);
      if (box.dataset['bound' + storeKey] === '1') continue;
      box.dataset['bound' + storeKey] = '1';
      bindHeader(box, key, storeKey);
    }
  }

  function foldConfig() {
    foldBoxes('view-config', 'cfg', 2);
    foldBoxes('view-packages', 'pkg', 1);
  }

  /* 任务中心：把「跳过 / 已完成」的行收起来。
     一个 qgroup 里十几行、绝大多数是「跳过 · 任务已完成或尚未解锁（快照）」，
     留着就是纯噪音；每组只显示能动的，其余收成一行。 */
  /* 自动换行：整站有大量 flex + nowrap 的工具条，子元素一多就横向溢出，
     后面的控件直接跑到卡片外面、压在别的东西上（请求记录那条 490px 塞 367px）。
     统一扫一遍：能滚动的不动，其它溢出的一律允许换行。 */
  function wrapOverflowRows() {
    var views = document.querySelectorAll('section.view');
    for (var v = 0; v < views.length; v++) {
      var nodes = views[v].querySelectorAll('div, header, form, span, p');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var cs = getComputedStyle(el);
        if (cs.display !== 'flex' && cs.display !== 'inline-flex') {
          if (el.classList.contains('ios-wrap')) el.classList.remove('ios-wrap');
          continue;
        }
        var scrollable = /auto|scroll/.test(cs.overflowX) || /auto|scroll/.test(cs.overflowY);
        var over = el.scrollWidth - el.clientWidth;
        if (!scrollable && over > 2 && cs.flexWrap === 'nowrap') {
          el.classList.add('ios-wrap');
        } else if (el.classList.contains('ios-wrap') && over <= 2) {
          el.classList.remove('ios-wrap');
        }
      }
    }
  }

  /* 指标太多读不过来：余额趋势 9 个数字排成一片，看不出哪个是重点。
     前 4 个留着一屏看清，其余收进「其余 N 项指标」。 */
  function foldTiles(containerId, keep) {
    var box = document.getElementById(containerId);
    if (!box) return;
    var tiles = [].slice.call(box.children).filter(function (c) {
      return c.classList.contains('st');
    });
    if (tiles.length <= keep) {
      var stale = box.querySelector('.st-more');
      if (stale) stale.remove();
      return;
    }
    var open = box.dataset.stOpen === '1';
    for (var i = keep; i < tiles.length; i++) {
      /* 用内联 !important 而不是 hidden 属性：.stats .st{display:flex!important}
         会压掉 [hidden]，折叠等于没折 */
      if (open) tiles[i].style.removeProperty('display');
      else tiles[i].style.setProperty('display', 'none', 'important');
    }
    var btn = box.querySelector('.st-more');
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'st-more';
      btn.type = 'button';
      btn.addEventListener('click', function (ev) {
        var b = ev.currentTarget.parentNode;
        b.dataset.stOpen = b.dataset.stOpen === '1' ? '0' : '1';
        sweep();
      });
      box.appendChild(btn);
    }
    btn.textContent = open
      ? '收起其余指标'
      : '其余 ' + (tiles.length - keep) + ' 项指标 · 展开';
  }

  /* 下拉按文字实测宽度定尺：面板各处 select 宽度是写死的（「全部档位」73px），
     加上我们自绘的箭头后，末字正好压在箭头上。
     用内联 !important 写 padding 与 min-width，绕开所有样式表层的特异性打架。 */
  function fitSelects() {
    var cv = document.createElement('canvas').getContext('2d');
    var sels = document.querySelectorAll('section.view select');
    for (var i = 0; i < sels.length; i++) {
      var s = sels[i];
      var cs = getComputedStyle(s);
      if (cs.display === 'none' || s.getBoundingClientRect().width === 0) continue;
      s.style.setProperty('padding-left', '10px', 'important');
      s.style.setProperty('padding-right', '30px', 'important');
      s.style.setProperty('height', '34px', 'important');
      s.style.setProperty('border-radius', '17px', 'important');
      var opt = s.options[s.selectedIndex];
      var txt = opt ? String(opt.text || '').trim() : '';
      if (!txt) continue;
      cv.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      var need = Math.ceil(cv.measureText(txt).width) + 10 + 30 + 2;
      if (s.getBoundingClientRect().width < need) {
        s.style.setProperty('min-width', need + 'px', 'important');
      } else {
        s.style.removeProperty('min-width');
      }
    }
  }

  function foldSkipped() {
    var view = document.getElementById('view-taskscenter');
    if (!view) return;
    var groups = view.querySelectorAll('.qgroup');
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      var rows = group.querySelectorAll('.qrow');
      var skipped = [];
      for (var r = 0; r < rows.length; r++) {
        var isSkip = !!rows[r].querySelector('.qdot.skip');
        rows[r].classList.toggle('tc-skip', isSkip);
        if (isSkip) skipped.push(rows[r]);
      }
      var open = group.dataset.skOpen === '1';
      for (var k = 0; k < skipped.length; k++) {
        if (open) skipped[k].style.removeProperty('display');
        else skipped[k].style.setProperty('display', 'none', 'important');
      }
      var btn = group.querySelector('.tc-more');
      if (!skipped.length) {
        if (btn) btn.remove();
        continue;
      }
      if (!btn) {
        btn = document.createElement('button');
        btn.className = 'tc-more';
        btn.type = 'button';
        btn.addEventListener('click', function (ev) {
          var grp = ev.currentTarget.parentNode;
          grp.dataset.skOpen = grp.dataset.skOpen === '1' ? '0' : '1';
          sweep();
        });
        group.appendChild(btn);
      }
      btn.textContent = open ? '收起已跳过' : '其余 ' + skipped.length + ' 项已跳过 · 展开';
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
    foldSkipped();
    foldTiles('bhStats', 4);
    fitSelects();
    wrapOverflowRows();
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

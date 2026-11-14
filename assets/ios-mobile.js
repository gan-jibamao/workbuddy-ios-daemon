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
    /* 只加不减：加完 .ios-wrap 之后元素就不再溢出，如果这里再按「不溢出」把类删掉，
       下一轮又会溢出 -> 加了删删了加，30ms 抖一次，屏幕上就是频闪。 */
    var views = document.querySelectorAll('section.view');
    for (var v = 0; v < views.length; v++) {
      var nodes = views[v].querySelectorAll('div, header, form, span, p');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (el.classList.contains('ios-wrap')) continue;
        var cs = getComputedStyle(el);
        if (cs.display !== 'flex' && cs.display !== 'inline-flex') continue;
        if (cs.flexWrap !== 'nowrap') continue;
        if (/auto|scroll/.test(cs.overflowX) || /auto|scroll/.test(cs.overflowY)) continue;
        if (el.scrollWidth - el.clientWidth > 2) el.classList.add('ios-wrap');
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
    var mtxt = open ? '收起其余指标' : '其余 ' + (tiles.length - keep) + ' 项指标 · 展开';
    /* textContent 每次赋值都换掉文本节点 -> 触发观察器 -> 再赋值，形成自激抖动 */
    if (btn.textContent !== mtxt) btn.textContent = mtxt;
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
      /* 账号卡标题格里那个「代理」下拉不参与定尺：它的 min-width 一变，
         整张六列网格的列宽就会重算，屏幕上看就是一闪。 */
      if (s.closest && s.closest("td[data-role='title']")) continue;
      /* 只在值不同的时候写：反复 set/remove 会让布局每轮抖一次 */
      if (cs.paddingLeft !== '10px') s.style.setProperty('padding-left', '10px', 'important');
      if (cs.paddingRight !== '30px') s.style.setProperty('padding-right', '30px', 'important');
      if (cs.height !== '34px') s.style.setProperty('height', '34px', 'important');
      if (cs.borderTopLeftRadius !== '17px') s.style.setProperty('border-radius', '17px', 'important');
      var opt = s.options[s.selectedIndex];
      var txt = opt ? String(opt.text || '').trim() : '';
      if (!txt) continue;
      cv.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      var need = Math.ceil(cv.measureText(txt).width) + 10 + 30 + 2;
      /* 只涨不缩：缩回去下一轮又不够宽，同样会造成来回抖动 */
      if (parseFloat(cs.minWidth) < need) {
        s.style.setProperty('min-width', need + 'px', 'important');
      }
    }
  }

  /* 余额趋势的指标原来是 9 个同规格小格子平铺：标签 10px、数值 16px，
     读起来是一串裸数字。这里按语义重新分级：
     合计 -> 通栏主卡（数值放大）；净变化 -> 带涨跌色的副行；其余 -> 三列小指标。 */
  function decorateStats() {
    var box = document.getElementById('bhStats');
    if (!box) return;
    var tiles = [].slice.call(box.children).filter(function (c) {
      return c.classList.contains('st');
    });
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      var kEl = t.querySelector('.k');
      var vEl = t.querySelector('.v');
      var label = kEl ? kEl.textContent.trim() : '';
      var val = vEl ? vEl.textContent.trim() : '';
      var isTotal = /合计|总额/.test(label);
      var isDelta = /净变化|变化/.test(label);
      t.classList.toggle('st-hero', isTotal);
      t.classList.toggle('st-delta', isDelta);
      if (isDelta) {
        t.classList.toggle('up', /^\+/.test(val));
        t.classList.toggle('down', /^-/.test(val));
      }
      if (isTotal) {
        if (kEl && !kEl.dataset.orig) kEl.dataset.orig = label;
        var short = label.replace(/^当前/, '').replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').trim() || '合计';
        if (kEl && kEl.textContent !== short) kEl.textContent = short;
        if (vEl && !vEl.dataset.unit) { vEl.dataset.unit = '1'; }
      }
    }
  }

  /* 账号卡上的「模型锁定 / 限流」信息（.rate-limits）在 -59 精简卡片时被整块藏掉，
     结果看不到哪个号被哪个模型锁了。这里把它抽成卡片里的独立一行：
     td.acc-lock 追加到行尾（面板重绘会丢，sweep 会再补），有锁才占那一行。 */
  function decorateLocks() {
    var body = document.getElementById('accBody');
    if (!body) return;
    for (var i = 0; i < body.rows.length; i++) {
      var tr = body.rows[i];
      var st = tr.querySelector("td[data-label='状态']");
      var rl = st ? st.querySelector('.rate-limits') : null;
      var cell = tr.querySelector('td.acc-lock');
      if (!rl) {
        if (cell) cell.remove();
        tr.classList.remove('has-lock');
        continue;
      }
      /* 模型名与恢复时间要分开读：「deepseek-v4.1-flash · 预计 … 恢复（剩余 …）」 */
      var bEl = rl.querySelector('b');
      var spEl = rl.querySelector('span');
      var model = bEl ? bEl.textContent.trim() : '';
      var rest = spEl ? spEl.textContent.replace(/\s+/g, ' ').trim() : '';
      /* 整句「预计 2026-11-15 01:40 恢复（剩余 8时43分）」在 341px 里放不下，
         收成「模型 · 剩余 8时43分」，完整内容留在 title 里。 */
      var m = /剩余\s*([0-9]+\s*时\s*[0-9]+\s*分|[0-9]+\s*分)/.exec(rest);
      var txt = model ? (model + (m ? ' · 剩余 ' + m[1].replace(/\s+/g, '') : (rest ? ' · ' + rest : '')))
                      : rest;
      if (!txt) txt = (rl.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt) {
        if (cell) cell.remove();
        tr.classList.remove('has-lock');
        continue;
      }
      tr.classList.add('has-lock');
      if (!cell) {
        cell = document.createElement('td');
        cell.className = 'acc-lock';
        /* 必须插在操作列「前面」：shape() 用「最后一格且含 button」来认操作列，
           插到最后会把真正的操作列挤成普通字段，按钮就整排不见了。 */
        var acts = tr.querySelector("td[data-role='acts']") || tr.cells[tr.cells.length - 1];
        if (acts && acts.parentNode === tr) tr.insertBefore(cell, acts);
        else tr.appendChild(cell);
      }
      if (cell.textContent !== txt) cell.textContent = txt;
      var title = rl.querySelector('.rate-limit');
      var t2 = title ? title.getAttribute('title') : '';
      if (t2 && cell.getAttribute('title') !== t2) cell.setAttribute('title', t2);
    }
  }

  /* 账号池每 5 秒轮询一次，面板的 setHTML 只在 HTML 逐字节相同时才跳过；
     而「最近成功」这类相对时间、用量计数几乎每轮都在变 -> 整张表 innerHTML 重建
     -> 整张卡闪一下。这里接管 accBody 的 innerHTML 赋值：行数、列数一致时逐格比对，
     只改真正变化的那几格，不再整表重画。 */
  function patchAccBody() {
    var tb = document.getElementById('accBody');
    if (!tb || tb.__iosPatched) return;
    var desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (!desc) return;
    tb.__iosPatched = 1;
    Object.defineProperty(tb, 'innerHTML', {
      configurable: true,
      get: function () { return desc.get.call(this); },
      set: function (html) {
        try {
          var tmp = document.createElement('tbody');
          desc.set.call(tmp, html);
          var oldRows = this.rows, newRows = tmp.rows;
          if (!newRows.length || oldRows.length !== newRows.length) {
            desc.set.call(this, html);
            return;
          }
          /* 我们自己插进去的 td.acc-lock 不在面板的新 HTML 里，
             比对和更新都要先把它排除，否则每轮都判成结构不一致 -> 整表重画。 */
          var real = function (row) {
            return [].slice.call(row.cells).filter(function (c) {
              return !c.classList.contains('acc-lock');
            });
          };
          for (var i = 0; i < oldRows.length; i++) {
            var a = oldRows[i], b = newRows[i];
            var ac = real(a), bc = real(b);
            if (ac.length !== bc.length) {
              desc.set.call(this, html);
              return;
            }
            if (a.getAttribute('title') !== b.getAttribute('title')) {
              a.setAttribute('title', b.getAttribute('title') || '');
            }
            for (var j = 0; j < ac.length; j++) {
              var ca = ac[j], cb = bc[j];
              if (ca.innerHTML === cb.innerHTML) continue;
              if (ca.textContent === cb.textContent) {
                /* 只有内部结构不同、文字一样：不动，避免无谓重排 */
                continue;
              }
              ca.innerHTML = cb.innerHTML;
            }
          }
        } catch (e) {
          desc.set.call(this, html);
        }
      }
    });
  }

  /* 「其余 N 个账号，展开」在表格里是一个 td 里的按钮。给它的父 td 打标，
     把 td 自己的内边距清掉，展开条才能贴着表格底边做成一条干净的脚注行。 */
  function markGroupToggles() {
    var ts = document.querySelectorAll('.pk-group-toggle');
    for (var i = 0; i < ts.length; i++) {
      var td = ts[i].parentNode;
      if (td && td.tagName === 'TD') {
        td.classList.add('pk-footer-td');
        /* 表格的 td 有 14px 上下内距，不清掉这条脚注行会比数据行还高 */
        if (td.style.padding !== '0px') td.style.setProperty('padding', '0', 'important');
      }
    }
  }

  /* 余额趋势「按账号」卡：净变化按正负上色，和今日/昨日同一套语义色。 */
  function decorateBalhist() {
    var t = document.querySelector('#view-balhist table');
    if (!t) return;
    var cells = t.querySelectorAll('td[data-label="净变化"]');
    for (var i = 0; i < cells.length; i++) {
      var s = (cells[i].textContent || '').trim();
      cells[i].classList.toggle('pos', /^\+/.test(s));
      cells[i].classList.toggle('neg', /^-/.test(s));
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
      var stxt = open ? '收起已跳过' : '其余 ' + skipped.length + ' 项已跳过 · 展开';
      if (btn.textContent !== stxt) btn.textContent = stxt;
    }
  }

  /* ── 执行 ───────────────────────────────────────────────────── */
  function sweep() {
    ensureScope();
    if (!sweep._e) { sweep._e = 1; patchExport(); }
    if (!sweep._v) { sweep._v = 1; window.setTimeout(startVersionWatch, 800); }
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
    /* 账号池主表打标：它和「积分到期提醒」表都是 as-cards，按标签做网格排布需要区分 */
    var accBody = document.getElementById('accBody');
    if (accBody) {
      var at = accBody.closest('table');
      if (at && !at.classList.contains('acc-main')) at.classList.add('acc-main');
    }
    foldConfig();
    foldSkipped();
    decorateStats();
    foldTiles('bhStats', 5); /* 主卡 + 净变化 + 3 个小指标，正好 5 格，不折叠 */
    fitSelects();
    decorateBalhist();
    markGroupToggles();
    patchAccBody();
    decorateLocks();
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

  /* 面板的「导出 ZIP」打的是 /panel/api/logs/export，实测这个端点会把进程打崩
     （响应断在 512 字节、launchd 记 last exit code = 2，server.log 里没有栈）。
     改成从 /panel/api/logs（环形缓冲快照）取数据，在本地生成 JSON 下载，
     不碰那个会把服务弄死的端点。 */
  function patchExport() {
    function doExport() {
      var key = '';
      try { key = localStorage.getItem('wb2api.key') || ''; } catch (e) {}
      var headers = key ? { Authorization: 'Bearer ' + key } : {};
      fetch('/panel/api/logs', { headers: headers }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (j) {
        var entries = (j && j.entries) || [];
        var payload = JSON.stringify({
          exported_at: new Date().toISOString(),
          count: entries.length,
          archive_error: j && j.archive_error || '',
          entries: entries
        }, null, 2);
        var blob = new Blob([payload], { type: 'application/json' });
        var d = new Date();
        var pad = function (n) { return (n < 10 ? '0' : '') + n; };
        var name = 'panel-logs-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
          '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 30000);
      }).catch(function (e) { alert('导出失败：' + (e && e.message || e)); });
    }
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      var btn = t && t.closest ? t.closest('#btnLogExport') : null;
      if (!btn) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      doExport();
    }, true);
    var lab = document.getElementById('logExportDays');
    if (lab && lab.parentNode) {
      var b = lab.parentNode.querySelector('#btnLogExport');
      if (b && b.textContent !== '导出') b.textContent = '导出';
    }
  }

  /* 版本自愈：面板页面一旦在旧版本上打开就不会自己刷新，
     用户看到的还是上几个版本的排版（我们这边怎么改都没用）。
     这里比对 daemon 报的版本号，不一致就整页重载一次，并用 sessionStorage 防循环。 */
  function checkVersion() {
    var MY = '61';
    try {
      var key = localStorage.getItem('wb2api.key') || '';
      fetch('/panel/api/overview', { headers: key ? { Authorization: 'Bearer ' + key } : {} })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j || !j.version) return;
          var m = /-arm64e-(\d+)$/.exec(j.version);
          if (!m) return;
          if (m[1] !== MY) {
            if (sessionStorage.getItem('__ios_patch_v') === j.version) return;
            sessionStorage.setItem('__ios_patch_v', j.version);
            location.reload();
          }
        })
        .catch(function () {});
    } catch (e) {}
  }

  function startVersionWatch() {
    if (startVersionWatch._t) return;
    checkVersion();
    startVersionWatch._t = window.setInterval(checkVersion, 15000);
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

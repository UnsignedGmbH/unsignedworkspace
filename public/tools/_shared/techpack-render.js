// Techpack page renderer — single source of truth for both the editor (editable
// inputs) and the PDF export (read-only rendering). Each page-type produces a
// DOM tree that visually matches the printed Unsigned techpack templates.
//
// Entry point:
//   window.tpRender.page(page, opts)
//     page:  Firebase node — { type, fields, images, notes }
//     opts:  {
//       editable:    boolean,                            // true → inputs, false → text
//       onField?:    (path: string, value: any) => void, // editor mode (editable=true)
//       onImage?:    (slot: string, file: File) => void, // editor mode upload
//       onImageRm?:  (slot: string) => void,             // editor mode remove
//       getMockup?:  (page) => string | null,            // resolves mockupRef → src
//       compress?:   File-compress helper (window.imgUtils.compress)
//       onMeasure?:  (idx: number, key: 'name'|'value', value: string) => void,
//       onMeasureAdd?: () => void,
//       onMeasureRm?:  (idx: number) => void,
//     }
//   window.tpRender.STANDARD_MEASUREMENTS — preset measurement labels per baseStyle

(function () {
  if (window.tpRender) return;

  var FONT = "'Montserrat', system-ui, sans-serif";
  var BORDER = '2px solid #111';
  var BORDER_THIN = '1.5px solid #111';

  // Standard-Measurements pro Garment. Reihenfolge entspricht den nummerierten
  // Pfeilen auf der jeweiligen measured-JPG. Labels sind vorbefüllt — User
  // muss nur noch die cm-Werte eintragen.
  function _named(names) {
    return names.map(function (n) { return { name: n }; });
  }
  var STANDARD_MEASUREMENTS = {
    tshirt: _named([
      'Body Length',
      'Chest Width (pit to pit)',
      'Bottom Width',
      'Neck Width',
      'Sleeve Length',
      'Sleeve Opening',
      'Shoulder Width',
      'Yoke Width',
      'Collar Rib',
      'Neck Drop',
      'Cross Shoulder',
    ]),
    tank: _named([
      'Neck Width',
      'Body Length',
      'Chest Width (pit to pit)',
      'Bottom Width',
      'Shoulder Width',
      'Strap Width',
      'Armhole Depth',
      'Neck Drop',
    ]),
    longsleeve: _named([
      'Body Length',
      'Chest Width (pit to pit)',
      'Bottom Width',
      'Neck Width',
      'Sleeve Length (shoulder→cuff)',
      'Cuff Width',
      'Shoulder Width',
      'Yoke Width',
      'Collar Rib',
      'Neck Drop',
      'Cross Shoulder',
      'Sleeve Opening',
      'Cuff Height',
    ]),
    'summer-sleeve': _named([
      'Body Length',
      'Chest Width (pit to pit)',
      'Bottom Width',
      'Neck Width',
      'Sleeve Length',
      'Sleeve Opening',
      'Shoulder Width',
      'Yoke Width',
      'Collar Rib',
      'Neck Drop',
      'Cross Shoulder',
    ]),
    crewneck: _named([
      'Body Length',
      'Chest Width (pit to pit)',
      'Bottom Rib Width',
      'Neck Width',
      'Sleeve Length',
      'Cuff Width',
      'Shoulder Width',
      'Yoke Width',
      'Collar Rib',
      'Neck Drop',
      'Cross Shoulder',
    ]),
    hoodie: _named([
      'Body Length',
      'Chest Width (pit to pit)',
      'Bottom Rib Width',
      'Hood Width',
      'Sleeve Length',
      'Cuff Width',
      'Shoulder Width',
      'Hood Height',
      'Pocket Width',
      'Pocket Height',
      'Cross Shoulder',
    ]),
    zipper: _named([
      'Body Length',
      'Chest Width (pit to pit)',
      'Bottom Rib Width',
      'Hood Width',
      'Sleeve Length',
      'Cuff Width',
      'Shoulder Width',
      'Hood Height',
      'Pocket Width',
      'Pocket Height',
      'Cross Shoulder',
    ]),
    'jogger-cuffed': _named([
      'Waist Width',
      'Hip Width',
      'Thigh Width',
      'Knee Width',
      'Cuff Width',
      'Inseam Length',
      'Outseam Length',
      'Front Rise',
    ]),
    'jogger-open': _named([
      'Waist Width',
      'Hip Width',
      'Thigh Width',
      'Knee Width',
      'Bottom Opening',
      'Inseam Length',
      'Outseam Length',
      'Front Rise',
    ]),
    shorts: _named([
      'Waist Width',
      'Hip Width',
      'Thigh Width',
      'Bottom Opening',
      'Inseam Length',
      'Outseam Length',
      'Front Rise',
    ]),
    'cap-normal': _named([
      'Crown Height',
      'Crown Diameter',
      'Brim Length',
      'Brim Width',
      'Sweatband Width',
    ]),
    'cap-trucker': _named([
      'Crown Height',
      'Crown Diameter',
      'Brim Length',
      'Mesh Panel Width',
      'Sweatband Width',
    ]),
    custom: [],
  };

  // Alle Mockups direkt aus den Brandwork-Originalvorlagen.
  // front     = clean Outline (für TP_START PRODUCT-Box)
  // measured  = Garment grau-gefüllt mit roten Maß-Pfeilen + nummerierten Kreisen
  //             (für TP_MEASUREMENTS)
  function _paths(slug) {
    return {
      front:    '/tools/_shared/mockups/' + slug + '.png',
      measured: '/tools/_shared/measured/' + slug + '-only.jpg',
    };
  }
  var MOCKUP_PATHS = {
    tshirt:          _paths('tshirt'),
    tank:            _paths('tanktop'),
    longsleeve:      _paths('longsleeve'),
    'summer-sleeve': _paths('summer-sleeve'),
    crewneck:        _paths('crewneck'),
    hoodie:          _paths('hoodie'),
    zipper:          _paths('zipper'),
    'jogger-cuffed': _paths('jogger-cuffed'),
    'jogger-open':   _paths('jogger-open'),
    shorts:          _paths('shorts'),
    'cap-normal':    _paths('cap-normal'),
    'cap-trucker':   _paths('cap-trucker'),
  };

  function mockupFor(baseStyle, view) {
    var paths = MOCKUP_PATHS[baseStyle];
    if (!paths) return null;
    return paths[view || 'front'] || paths.front || null;
  }

  // ── DOM helpers ────────────────────────────────────────────────────────

  function el(tag, opts) {
    var e = document.createElement(tag);
    if (!opts) return e;
    if (opts.cls) e.className = opts.cls;
    if (opts.text != null) e.textContent = opts.text;
    if (opts.style) Object.keys(opts.style).forEach(function (k) { e.style[k] = opts.style[k]; });
    if (opts.children) opts.children.forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function getByPath(obj, path) {
    var parts = path.split('/');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  // Field box: header (black bar with white text) + value area (input or text).
  function fieldBox(o) {
    var isMobile = (typeof window !== 'undefined') && window.innerWidth < 600;
    var box = el('div', {
      style: {
        border: BORDER,
        borderRadius: '6px',
        overflow: 'hidden',
        // flex: '1 1 auto' = grow into extra space, shrink if needed, basis content-size.
        // Basis 'auto' (statt 0) verhindert dass das Element auf Mobile in einem
        // column-flex auf 0px kollabiert.
        flex: o.flex || '1 1 auto',
        minWidth: '0',
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
      },
    });
    box.appendChild(el('div', {
      text: o.label + ':',
      style: {
        background: '#111',
        color: '#fff',
        fontFamily: FONT,
        fontWeight: '900',
        fontSize: isMobile ? '11px' : '13px',
        letterSpacing: '0.6px',
        padding: isMobile ? '6px 8px' : '8px 12px',
        textTransform: 'uppercase',
        textAlign: 'center',
      },
    }));
    var v = getByPath(o.page, o.path);
    if (v == null) v = '';
    var common = {
      width: '100%',
      // basis 'auto' verhindert Collapse-zu-0 in column-flex Parent (fieldBox).
      flex: '1 1 auto',
      border: '0',
      outline: '0',
      padding: o.big ? (isMobile ? '10px 10px' : '14px 12px') : (isMobile ? '8px 10px' : '10px 12px'),
      fontFamily: FONT,
      fontWeight: o.big ? '800' : '700',
      fontSize: o.big ? (isMobile ? '15px' : '20px') : (isMobile ? '13px' : '15px'),
      textAlign: o.multiline ? 'left' : 'center',
      background: '#fff',
      color: '#111',
      textTransform: o.upper ? 'uppercase' : 'none',
      whiteSpace: 'pre-line',
      minHeight: o.minH ? (o.minH + 'px') : (o.big ? '46px' : '34px'),
      lineHeight: '1.25',
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      justifyContent: o.multiline ? 'flex-start' : 'center',
      wordBreak: 'break-word',
    };
    if (o.opts.editable) {
      var input;
      if (o.multiline) {
        input = document.createElement('textarea');
        input.style.resize = 'none';
        input.style.display = 'block';
        common.alignItems = 'stretch';
      } else if (o.type === 'select' && Array.isArray(o.options)) {
        input = document.createElement('select');
        o.options.forEach(function (op) {
          var optEl = document.createElement('option');
          optEl.value = op.value !== undefined ? op.value : op;
          optEl.textContent = op.label !== undefined ? op.label : op;
          if (optEl.value === v) optEl.selected = true;
          input.appendChild(optEl);
        });
      } else {
        input = document.createElement('input');
        input.type = o.type || 'text';
      }
      if (input.tagName !== 'SELECT') input.value = String(v);
      input.placeholder = o.placeholder || '';
      Object.keys(common).forEach(function (k) { input.style[k] = common[k]; });
      // Layout-hack: form-controls block, not flex.
      input.style.display = 'block';
      input.style.alignItems = '';
      input.style.justifyContent = '';
      if (input.tagName === 'SELECT') input.style.cursor = 'pointer';
      var save = function () { o.opts.onField(o.path, input.value); };
      input.oninput = save;
      input.onchange = save;
      box.appendChild(input);
    } else {
      box.appendChild(el('div', { text: String(v || ' '), style: common }));
    }
    return box;
  }

  function row(items, opts) {
    opts = opts || {};
    var isMobile = (typeof window !== 'undefined') && window.innerWidth < 600;
    // Mobile: pure block flow — items stacken sich automatisch in voller Breite.
    // Flex auf den Children (z.B. fieldBox flex:1) wird im Block-Parent ignoriert,
    // also kein collapse-zu-0px durch flex-basis:0 in column-flex.
    if (isMobile) {
      var wrap = el('div', {
        style: { marginBottom: (opts.mb != null ? opts.mb : 12) + 'px' },
      });
      items.forEach(function (it, i) {
        if (it) {
          if (i > 0) it.style.marginTop = '8px';
          wrap.appendChild(it);
        }
      });
      return wrap;
    }
    return el('div', {
      style: {
        display: 'flex',
        gap: (opts.gap || 12) + 'px',
        marginBottom: (opts.mb != null ? opts.mb : 12) + 'px',
        flex: opts.flex || 'none',
      },
      children: items,
    });
  }

  function bigBox(title, body, o) {
    o = o || {};
    var box = el('div', {
      style: {
        border: BORDER,
        borderRadius: '8px',
        overflow: 'hidden',
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        // flex 1 1 auto: basis content-size — verhindert collapse-zu-0 in column-flex.
        flex: o.flex || '1 1 auto',
        marginBottom: (o.mb != null ? o.mb : 12) + 'px',
        minHeight: (o.minH || 0) + 'px',
      },
    });
    if (title) {
      box.appendChild(el('div', {
        text: title,
        style: {
          background: o.titleDark ? '#111' : '#fff',
          color: o.titleDark ? '#fff' : '#111',
          fontFamily: FONT,
          fontWeight: '900',
          fontSize: '12px',
          padding: '8px 12px',
          letterSpacing: '0.4px',
          textTransform: 'uppercase',
          borderBottom: o.titleDark ? '0' : BORDER_THIN,
        },
      }));
    }
    var inner = el('div', {
      style: {
        flex: '1',
        padding: o.padded === false ? '0' : '12px',
        display: 'flex',
        flexDirection: o.column !== false ? 'column' : 'row',
        gap: '10px',
        alignItems: o.center ? 'center' : 'stretch',
        justifyContent: o.center ? 'center' : 'flex-start',
        background: '#fff',
        minHeight: '0',
      },
    });
    (Array.isArray(body) ? body : [body]).forEach(function (c) { if (c) inner.appendChild(c); });
    box.appendChild(inner);
    return box;
  }

  function imageSlot(o) {
    // o: { src, slot, label, page, opts, height, fallback? (HTMLElement) }
    var isMobile = (typeof window !== 'undefined') && window.innerWidth < 600;
    var h = o.height || 320;
    if (isMobile) h = Math.min(h, 240);
    var slot = el('div', {
      style: {
        position: 'relative',
        width: '100%',
        minHeight: h + 'px',
        background: '#fff',
        border: (o.src || o.fallback) ? '0' : '1.5px dashed #aaa',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        cursor: o.opts.editable ? 'pointer' : 'default',
      },
    });
    if (o.src) {
      var img = document.createElement('img');
      img.src = o.src;
      img.style.maxWidth = '100%';
      img.style.maxHeight = h + 'px';
      img.style.objectFit = 'contain';
      img.style.display = 'block';
      slot.appendChild(img);
      if (o.opts.editable) {
        var rm = el('button', {
          text: '×',
          style: {
            position: 'absolute',
            top: '8px',
            right: '8px',
            width: '28px',
            height: '28px',
            background: 'rgba(255,255,255,.95)',
            border: '1px solid #aaa',
            borderRadius: '6px',
            color: '#a73e3e',
            fontWeight: '900',
            fontSize: '16px',
            cursor: 'pointer',
            zIndex: '5',
          },
        });
        rm.type = 'button';
        rm.title = 'Bild entfernen';
        rm.onclick = function (e) {
          e.stopPropagation();
          if (o.opts.onImageRm) o.opts.onImageRm(o.slot);
        };
        slot.appendChild(rm);
      }
    } else if (o.fallback) {
      slot.appendChild(o.fallback);
      if (o.opts.editable) {
        slot.appendChild(el('div', {
          text: 'Klicken zum eigenen Foto hochladen',
          style: {
            position: 'absolute',
            bottom: '6px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(255,255,255,0.92)',
            border: '1px solid #ccc',
            borderRadius: '4px',
            padding: '4px 10px',
            fontFamily: FONT,
            fontSize: '10px',
            fontWeight: '700',
            color: '#666',
            zIndex: '3',
          },
        }));
      }
    } else {
      slot.appendChild(el('div', {
        text: o.opts.editable ? '+ ' + (o.placeholder || (o.label || 'Bild') + ' hochladen') : '— kein Bild —',
        style: { color: '#888', fontFamily: FONT, fontSize: '12px', fontWeight: '700', textAlign: 'center', padding: '8px 14px' },
      }));
    }
    if (o.opts.editable) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.cssText = 'position:absolute;inset:0;opacity:0;cursor:pointer;z-index:4;';
      input.onchange = function () {
        var f = input.files && input.files[0];
        if (!f) return;
        if (o.opts.onImage) o.opts.onImage(o.slot, f);
        input.value = '';
      };
      slot.appendChild(input);
    }
    return slot;
  }

  // Default-Mockup für TP_START PRODUCT-Box: Brandwork-Mockup zentriert.
  function defaultProductRow(baseStyle) {
    var paths = MOCKUP_PATHS[baseStyle];
    if (!paths || !paths.front) return null;
    var wrap = el('div', {
      style: {
        display: 'flex',
        gap: '20px',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        padding: '20px',
        boxSizing: 'border-box',
      },
    });
    var img = document.createElement('img');
    img.src = paths.front;
    img.style.maxHeight = '380px';
    img.style.maxWidth = '85%';
    img.style.objectFit = 'contain';
    wrap.appendChild(img);
    return wrap;
  }

  function pageRoot(builder) {
    // Editor-Mode: Content-driven height (auf Handy fluide). PDF-Mode überschreibt
    // nachträglich fixed 1200×1200 via direktem style-Override in techpack-pdf.js.
    var isMobile = (typeof window !== 'undefined') && window.innerWidth < 600;
    var wrap = el('div', {
      style: {
        width: '100%',
        maxWidth: '1080px',
        margin: '0 auto',
        background: '#fff',
        padding: isMobile ? '14px 14px 40px' : '32px 32px 50px',
        boxSizing: 'border-box',
        fontFamily: FONT,
        color: '#111',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        border: '0.5px solid rgba(0,0,0,0.1)',
        borderRadius: '8px',
        boxShadow: '0 4px 18px rgba(0,0,0,0.04)',
      },
    });
    builder(wrap);
    // Echtes Unsigned-Logo (extrahiert aus den Originalvorlagen).
    var footer = el('div', {
      style: {
        position: 'absolute',
        left: '0',
        right: '0',
        bottom: '14px',
        textAlign: 'center',
      },
    });
    var logo = document.createElement('img');
    logo.src = '/tools/_shared/unsigned-footer.png';
    logo.alt = 'unsigned';
    logo.style.cssText = 'height:32px;width:auto;display:inline-block;';
    footer.appendChild(logo);
    wrap.appendChild(footer);
    return wrap;
  }

  // ── Page-Type renderers ───────────────────────────────────────────────

  var TYPES = {};

  TYPES.TP_START = function (page, opts) {
    return pageRoot(function (wrap) {
      // Top-Section: 2-Spalten-Quadrant matching TP LONGSLEEVE neu.pdf
      var top = el('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
          gap: '14px',
          marginBottom: '12px',
        },
      });
      // Linker Quadrant: BRAND / STYLE / COLLECTION DROP + SAMPLE SIZE / QTY
      var left = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
      left.appendChild(row([
        fieldBox({ label: 'Brand',           path: 'fields/brand',     page: page, opts: opts, big: true, upper: true, placeholder: 'UNSIGNED' }),
        fieldBox({ label: 'Style',           path: 'fields/style',     page: page, opts: opts, big: true, upper: true, placeholder: 'TSHIRT' }),
        fieldBox({ label: 'Collection Drop', path: 'fields/drop',      page: page, opts: opts, big: true, upper: true, placeholder: 'B/FRIDAY 25' }),
      ], { gap: 10, mb: 0 }));
      left.appendChild(row([
        fieldBox({ label: 'Sample Size',     path: 'fields/sampleSize', page: page, opts: opts, big: true, upper: true, placeholder: 'M' }),
        fieldBox({ label: 'Sample Quantity', path: 'fields/sampleQty',  page: page, opts: opts, big: true, type: 'number', placeholder: '1' }),
      ], { gap: 10, mb: 0 }));
      top.appendChild(left);
      // Rechter Quadrant: COLOR / PANTONE + SURFACE / QUALITY
      var right = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
      right.appendChild(row([
        fieldBox({ label: 'Color',        path: 'fields/color',   page: page, opts: opts, big: true, upper: true, placeholder: 'WHITE' }),
        fieldBox({ label: 'Pantone Code', path: 'fields/pantone', page: page, opts: opts, big: true, upper: true, placeholder: '11-0601 TCX' }),
      ], { gap: 10, mb: 0 }));
      right.appendChild(row([
        fieldBox({ label: 'Surface',  path: 'fields/surface', page: page, opts: opts, big: true, upper: true, placeholder: '260GSM' }),
        fieldBox({ label: 'Quality',  path: 'fields/quality', page: page, opts: opts, big: true, upper: true, placeholder: '100% COTTON' }),
      ], { gap: 10, mb: 0 }));
      top.appendChild(right);
      wrap.appendChild(top);

      // PRODUCT-Box (full width, gross): bei keinem Upload → Default-Mockup-Reihe.
      var fallback = (!page.images || !page.images.product) ? defaultProductRow(opts.baseStyle) : null;
      wrap.appendChild(bigBox('Product', [
        imageSlot({
          src: (page.images || {}).product,
          slot: 'product',
          label: 'Product',
          opts: opts,
          height: 420,
          fallback: fallback,
        }),
      ], { flex: '1', center: true }));

      // EXTRA NOTE schmaler Streifen unten
      wrap.appendChild(fieldBox({
        label: 'Extra Note',
        path: 'notes/extra',
        page: page,
        opts: opts,
        multiline: true,
        minH: 50,
        placeholder: 'I love unsigned',
      }));
    });
  };

  TYPES.TP_PRINT = function (page, opts) {
    return pageRoot(function (wrap) {
      wrap.appendChild(fieldBox({
        label: 'Print Method',
        path: 'fields/method',
        page: page,
        opts: opts,
        big: true,
        upper: true,
        type: 'select',
        options: [
          { value: '',             label: '— wählen —' },
          { value: 'DTG',          label: 'DTG (Direct-to-Garment)' },
          { value: 'Screenprint',  label: 'Screenprint' },
          { value: 'Sublimation',  label: 'Sublimation' },
          { value: 'Embroidery',   label: 'Embroidery' },
          { value: 'Patch',        label: 'Patch' },
          { value: 'Heat Transfer',label: 'Heat Transfer' },
          { value: 'Puff Print',   label: 'Puff Print' },
          { value: 'Foil',         label: 'Foil' },
        ],
      }));
      var grid = el('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
          gap: '12px',
          flex: '1',
        },
        children: [
          bigBox('Print Layout', [imageSlot({
            src: (page.images || {}).print, slot: 'print', label: 'Print Layout', opts: opts, height: 320,
          })], { center: true }),
          bigBox('Look Reference', [imageSlot({
            src: (page.images || {}).look, slot: 'look', label: 'Look Reference', opts: opts, height: 320,
          })], { center: true }),
        ],
      });
      wrap.appendChild(grid);
      wrap.appendChild(fieldBox({
        label: 'Position',
        path: 'fields/position',
        page: page, opts: opts,
        multiline: true, minH: 50,
        placeholder: 'z.B. Logo zentriert auf Brust',
      }));
      wrap.appendChild(fieldBox({
        label: 'Extra Note',
        path: 'notes/extra',
        page: page, opts: opts,
        multiline: true, minH: 50,
        placeholder: 'z.B. Print should have a cracked look',
      }));
    });
  };

  TYPES.TP_PRINT_SIZE = function (page, opts) {
    return pageRoot(function (wrap) {
      wrap.appendChild(row([
        fieldBox({ label: 'Print Size', path: 'fields/size',     page: page, opts: opts, big: true, upper: true, placeholder: '42 cm' }),
        fieldBox({ label: 'Position',   path: 'fields/position', page: page, opts: opts, big: true, placeholder: 'mittig, 8cm vom Halsansatz' }),
      ]));
      wrap.appendChild(bigBox('Print mit Maßen', [imageSlot({
        src: (page.images || {}).printsize, slot: 'printsize', label: 'Print mit Maßen', opts: opts, height: 480,
      })], { flex: '1', center: true }));
      wrap.appendChild(fieldBox({ label: 'Extra Note', path: 'notes/extra', page: page, opts: opts, multiline: true, minH: 60 }));
    });
  };

  TYPES.TP_PRINT_INFO = function (page, opts) {
    var hex = String((page.fields || {}).hexCodes || '');
    var lines = hex.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    return pageRoot(function (wrap) {
      var swatchBox = el('div', {
        style: {
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px',
          padding: '12px',
        },
      });
      if (!lines.length) {
        swatchBox.appendChild(el('div', {
          text: opts.editable ? 'Hex-Codes unten eingeben (ein Code pro Zeile)' : '— keine Hex-Codes erfasst —',
          style: { color: '#888', fontFamily: FONT, fontSize: '13px', padding: '8px 4px' },
        }));
      }
      lines.forEach(function (h) {
        var item = el('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: '10px',
            border: BORDER_THIN, borderRadius: '6px',
            padding: '6px 10px',
            fontFamily: FONT, fontWeight: '800', fontSize: '13px',
          },
          children: [
            el('span', { style: { width: '26px', height: '26px', background: h, border: '1px solid #111', borderRadius: '4px' } }),
            el('span', { text: h }),
          ],
        });
        swatchBox.appendChild(item);
      });
      wrap.appendChild(bigBox('Color Swatches', [swatchBox], { flex: '1', padded: false }));
      wrap.appendChild(fieldBox({
        label: 'Hex-Codes (eine pro Zeile)',
        path: 'fields/hexCodes',
        page: page, opts: opts,
        multiline: true, minH: 100,
        placeholder: '#ffffff\n#d54640\n#353334',
      }));
      wrap.appendChild(fieldBox({
        label: 'Wichtiger Hinweis',
        path: 'notes/important',
        page: page, opts: opts,
        multiline: true, minH: 50,
        placeholder: 'IMPORTANT: do the same pattern for the back but without print',
      }));
      wrap.appendChild(fieldBox({
        label: 'Extra Note',
        path: 'notes/extra',
        page: page, opts: opts,
        multiline: true, minH: 50,
      }));
    });
  };

  TYPES.TP_MOLD_INFO = function (page, opts) {
    return pageRoot(function (wrap) {
      wrap.appendChild(fieldBox({
        label: 'Mold Type',
        path: 'fields/moldType',
        page: page, opts: opts,
        big: true, upper: true,
        placeholder: 'EMBROIDERY · RUBBER PATCH · SILICON MOLD',
      }));
      wrap.appendChild(bigBox('Mold-Bild', [imageSlot({
        src: (page.images || {}).mold, slot: 'mold', label: 'Mold-Bild', opts: opts, height: 380,
      })], { flex: '1', center: true }));
      wrap.appendChild(fieldBox({
        label: 'Beschreibung',
        path: 'fields/desc',
        page: page, opts: opts,
        multiline: true, minH: 60,
      }));
      wrap.appendChild(fieldBox({
        label: 'Extra Note',
        path: 'notes/extra',
        page: page, opts: opts,
        multiline: true, minH: 50,
      }));
    });
  };

  TYPES.TP_WASH_INFO = function (page, opts) {
    var SYMBOLS = [
      'Wash inside out', 'Wash dark colors separately', 'Hand wash', 'Machine wash cold',
      'Do not bleach', 'Do not iron over print', 'Do not dry in direct sunlight', 'Reshape whilst damp',
      'Tumble dry low', 'Dry clean only', 'Hang dry', '30°C max',
    ];
    var checks = (page.fields && page.fields.wash) || {};
    return pageRoot(function (wrap) {
      var grid = el('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
          gap: '8px',
          padding: '12px',
        },
      });
      SYMBOLS.forEach(function (sym) {
        var on = !!checks[sym];
        var item = el('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 10px',
            border: BORDER_THIN,
            borderRadius: '6px',
            background: on ? '#111' : '#fff',
            color: on ? '#fff' : '#111',
            fontFamily: FONT,
            fontWeight: '700',
            fontSize: '12px',
            cursor: opts.editable ? 'pointer' : 'default',
          },
        });
        item.appendChild(el('span', { text: on ? '✓' : '○', style: { fontWeight: '900', minWidth: '12px', textAlign: 'center' } }));
        item.appendChild(el('span', { text: sym }));
        if (opts.editable) {
          item.onclick = function () {
            var n = !on;
            var wc = Object.assign({}, checks);
            if (n) wc[sym] = true; else delete wc[sym];
            opts.onField('fields/wash', wc);
          };
        }
        grid.appendChild(item);
      });
      wrap.appendChild(bigBox('Wasch-Symbole', [grid], { flex: '1', padded: false }));
      wrap.appendChild(fieldBox({
        label: 'Care-Hinweise',
        path: 'fields/careText',
        page: page, opts: opts,
        multiline: true, minH: 60,
        placeholder: 'z.B. Made in Turkey · Made with love · Take care of it',
      }));
      wrap.appendChild(fieldBox({
        label: 'Extra Note',
        path: 'notes/extra',
        page: page, opts: opts,
        multiline: true, minH: 50,
      }));
    });
  };

  TYPES.TP_FABRIC_INFO = function (page, opts) {
    return pageRoot(function (wrap) {
      wrap.appendChild(row([
        fieldBox({ label: 'Fabric Type', path: 'fields/type', page: page, opts: opts, big: true, upper: true, placeholder: 'FRENCH TERRY' }),
        fieldBox({ label: 'GSM',         path: 'fields/gsm',  page: page, opts: opts, big: true, type: 'number', placeholder: '260' }),
      ]));
      wrap.appendChild(fieldBox({
        label: 'Composition',
        path: 'fields/composition',
        page: page, opts: opts,
        big: true, upper: true,
        placeholder: '100% COTTON',
      }));
      wrap.appendChild(bigBox('Fabric Look', [imageSlot({
        src: (page.images || {}).fabric, slot: 'fabric', label: 'Fabric Look', opts: opts, height: 360,
      })], { flex: '1', center: true }));
      wrap.appendChild(fieldBox({
        label: 'Extra Note',
        path: 'notes/extra',
        page: page, opts: opts,
        multiline: true, minH: 50,
      }));
    });
  };

  TYPES.TP_MEASUREMENTS = function (page, opts) {
    var f = page.fields || {};
    var ms = Array.isArray(f.measurements) ? f.measurements : [];
    var mockSrc = (typeof opts.getMockup === 'function') ? opts.getMockup(page) : null;
    return pageRoot(function (wrap) {
      var grid = el('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
          gap: '14px',
          flex: '1',
        },
      });

      // ---- Left: mockup + (editor only) Style-Picker ----
      var mockChildren = [];
      if (opts.editable) {
        // Inline-Picker direkt über dem Mockup — User wechselt die Basis-Zeichnung.
        var picker = el('div', { style: { padding: '8px 10px', display: 'flex', gap: '8px', alignItems: 'center', borderBottom: BORDER_THIN, background: '#fafafa', fontSize: '11px', flexWrap: 'wrap' } });
        picker.appendChild(el('span', { text: 'Mockup-Style:', style: { fontWeight: '900', color: '#555' } }));
        var sel = document.createElement('select');
        sel.style.cssText = 'border:1px solid #ccc;border-radius:6px;padding:4px 8px;font-family:' + FONT + ';font-weight:700;font-size:11px;background:#fff;cursor:pointer;';
        var styles = [
          { id: 'tshirt', label: 'T-Shirt' }, { id: 'tank', label: 'Tank Top' },
          { id: 'longsleeve', label: 'Longsleeve' }, { id: 'summer-sleeve', label: 'Summer Sleeve' },
          { id: 'crewneck', label: 'Crewneck' }, { id: 'hoodie', label: 'Hoodie' },
          { id: 'zipper', label: 'Zip-Hoodie' }, { id: 'jogger-cuffed', label: 'Jogger (cuffed)' },
          { id: 'jogger-open', label: 'Jogger (open)' }, { id: 'shorts', label: 'Shorts' },
          { id: 'cap-normal', label: 'Cap' }, { id: 'cap-trucker', label: 'Cap (Trucker)' },
        ];
        styles.forEach(function (s) {
          var op = document.createElement('option');
          op.value = s.id; op.textContent = s.label;
          if (s.id === f.mockupRef) op.selected = true;
          sel.appendChild(op);
        });
        sel.onchange = function () { opts.onField('fields/mockupRef', sel.value); };
        picker.appendChild(sel);
        mockChildren.push(picker);
      }
      mockChildren.push(imageSlot({
        src: mockSrc,
        slot: 'mockup',
        label: 'Mockup hochladen',
        opts: opts,
        height: 520,
      }));
      var mockHost = bigBox('Mock Up', mockChildren, { center: false, flex: '1', padded: false });
      grid.appendChild(mockHost);

      // ---- Right: measurement list ----
      var listWrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', minHeight: '0', overflow: 'auto' } });
      if (!ms.length) {
        listWrap.appendChild(el('div', {
          text: opts.editable ? 'Maße werden automatisch beim Anlegen geladen — oder eines hinzufügen.' : '— keine Maße erfasst —',
          style: { color: '#888', fontFamily: FONT, fontSize: '12px', padding: '4px 0' },
        }));
      }
      ms.forEach(function (m, i) {
        var rowEl = el('div', {
          style: {
            display: 'grid',
            gridTemplateColumns: '32px 1fr 80px ' + (opts.editable ? '24px' : ''),
            gap: '6px',
            alignItems: 'stretch',
            border: BORDER_THIN,
            borderRadius: '6px',
            overflow: 'hidden',
            background: '#fff',
          },
        });
        rowEl.appendChild(el('div', {
          text: String(i + 1),
          style: {
            background: '#111', color: '#fff',
            fontFamily: FONT, fontWeight: '900', fontSize: '13px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          },
        }));
        if (opts.editable) {
          var nameInp = document.createElement('input');
          nameInp.type = 'text';
          nameInp.value = m.name || '';
          nameInp.placeholder = 'z.B. Body Length';
          nameInp.style.cssText = 'border:0;outline:0;padding:8px 10px;font-family:' + FONT + ';font-weight:700;font-size:13px;background:transparent;width:100%;';
          nameInp.oninput = function () { if (opts.onMeasure) opts.onMeasure(i, 'name', nameInp.value); };
          rowEl.appendChild(nameInp);
          var valInp = document.createElement('input');
          valInp.type = 'text';
          valInp.value = m.value || '';
          valInp.placeholder = 'cm';
          valInp.style.cssText = 'border:0;border-left:' + BORDER_THIN + ';outline:0;padding:8px 10px;font-family:' + FONT + ';font-weight:900;font-size:14px;background:transparent;width:100%;text-align:right;';
          valInp.oninput = function () { if (opts.onMeasure) opts.onMeasure(i, 'value', valInp.value); };
          rowEl.appendChild(valInp);
          var rm = el('button', {
            text: '×',
            style: {
              border: '0', background: 'transparent',
              color: '#a73e3e', cursor: 'pointer',
              fontWeight: '900', fontSize: '14px',
            },
          });
          rm.type = 'button';
          rm.title = 'Maß entfernen';
          rm.onclick = function () { if (opts.onMeasureRm) opts.onMeasureRm(i); };
          rowEl.appendChild(rm);
        } else {
          rowEl.appendChild(el('div', {
            text: m.name || '',
            style: { padding: '8px 10px', fontFamily: FONT, fontWeight: '700', fontSize: '13px', display: 'flex', alignItems: 'center' },
          }));
          var v = m.value || '';
          if (v && /\d/.test(v) && !/cm/i.test(v)) v = v + ' cm';
          rowEl.appendChild(el('div', {
            text: v,
            style: { padding: '8px 10px', borderLeft: BORDER_THIN, fontFamily: FONT, fontWeight: '900', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' },
          }));
        }
        listWrap.appendChild(rowEl);
      });
      if (opts.editable) {
        var addBtn = el('button', {
          text: '+ Maß hinzufügen',
          style: {
            border: '1px dashed #aaa',
            borderRadius: '6px',
            padding: '8px 12px',
            fontFamily: FONT, fontSize: '12px', fontWeight: '700',
            color: '#555',
            background: '#fff',
            cursor: 'pointer',
            alignSelf: 'flex-start',
            marginTop: '4px',
          },
        });
        addBtn.type = 'button';
        addBtn.onclick = function () { if (opts.onMeasureAdd) opts.onMeasureAdd(); };
        listWrap.appendChild(addBtn);
      }
      var listBox = bigBox('Measurements', [listWrap], { flex: '1' });
      grid.appendChild(listBox);

      wrap.appendChild(grid);
      wrap.appendChild(fieldBox({
        label: 'Extra Note',
        path: 'notes/extra',
        page: page, opts: opts,
        multiline: true, minH: 50,
      }));
    });
  };

  TYPES.TP_LABELS = function (page, opts) {
    var imgs = page.images || {};
    return pageRoot(function (wrap) {
      var grid = el('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
          gap: '12px',
          flex: '1',
        },
        children: [
          bigBox('Hangtag', [imageSlot({ src: imgs.hangtag, slot: 'hangtag', label: 'Hangtag', opts: opts, height: 200 })], { center: true }),
          bigBox('Care Label', [imageSlot({ src: imgs.care, slot: 'care', label: 'Care Label', opts: opts, height: 200 })], { center: true }),
          bigBox('Main Label', [
            imageSlot({ src: imgs.main, slot: 'main', label: 'Main Label', opts: opts, height: 130 }),
            fieldBox({ label: 'Größe', path: 'fields/mainSize', page: page, opts: opts, placeholder: '4,5 × 1,5 cm' }),
          ], { center: false }),
          bigBox('Extra Label', [imageSlot({ src: imgs.extra, slot: 'extra', label: 'Extra Label', opts: opts, height: 200 })], { center: true }),
        ],
      });
      wrap.appendChild(grid);
      wrap.appendChild(fieldBox({
        label: 'Care-Label-Text',
        path: 'fields/careText',
        page: page, opts: opts,
        multiline: true, minH: 60,
        placeholder: 'WASH INSIDE OUT\nDO NOT IRON OVER THE PRINT',
      }));
      wrap.appendChild(fieldBox({
        label: 'Extra Note',
        path: 'notes/extra',
        page: page, opts: opts,
        multiline: true, minH: 40,
      }));
    });
  };

  TYPES.TP_EXTRA_INFO = function (page, opts) {
    var imgs = page.images || {};
    return pageRoot(function (wrap) {
      var grid = el('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
          gap: '12px',
          flex: '1',
        },
        children: [
          bigBox('Print Look', [imageSlot({ src: imgs.print_look, slot: 'print_look', label: 'Print Look', opts: opts, height: 460 })], { center: true }),
          bigBox('Fit Look',   [imageSlot({ src: imgs.fit_look,   slot: 'fit_look',   label: 'Fit Look',   opts: opts, height: 460 })], { center: true }),
        ],
      });
      wrap.appendChild(grid);
      wrap.appendChild(fieldBox({
        label: 'Inspo',
        path: 'fields/inspo',
        page: page, opts: opts,
        multiline: true, minH: 60,
      }));
      wrap.appendChild(fieldBox({
        label: 'Extra Note',
        path: 'notes/extra',
        page: page, opts: opts,
        multiline: true, minH: 50,
      }));
    });
  };

  TYPES.TP_PACKAGING = function (page, opts) {
    var sizes = ['XS','S','M','L','XL','XXL','3XL'];
    var sb = (page.fields && page.fields.sizeBreakdown) || {};
    return pageRoot(function (wrap) {
      var grid = el('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
          gap: '14px',
          flex: '1',
        },
      });

      // Size breakdown grid
      var col = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
      sizes.forEach(function (sz) {
        var rowEl = el('div', {
          style: {
            display: 'grid',
            gridTemplateColumns: '70px 1fr',
            border: BORDER, borderRadius: '6px', overflow: 'hidden',
          },
        });
        rowEl.appendChild(el('div', {
          text: sz,
          style: {
            background: '#111', color: '#fff',
            fontFamily: FONT, fontWeight: '900', fontSize: '13px',
            padding: '12px 8px', textAlign: 'center',
          },
        }));
        if (opts.editable) {
          var inp = document.createElement('input');
          inp.type = 'number';
          inp.placeholder = '0';
          inp.value = sb[sz] || '';
          inp.style.cssText = 'border:0;outline:0;padding:12px 14px;font-family:' + FONT + ';font-weight:900;font-size:18px;background:#fff;width:100%;';
          inp.oninput = function () {
            var nb = Object.assign({}, sb);
            if (inp.value) nb[sz] = inp.value; else delete nb[sz];
            opts.onField('fields/sizeBreakdown', nb);
          };
          rowEl.appendChild(inp);
        } else {
          rowEl.appendChild(el('div', {
            text: sb[sz] || '—',
            style: { padding: '12px 14px', fontFamily: FONT, fontWeight: '900', fontSize: '18px' },
          }));
        }
        col.appendChild(rowEl);
      });
      grid.appendChild(bigBox('Size Breakdown', [col], { flex: '1' }));
      grid.appendChild(bigBox('Packaging', [imageSlot({
        src: (page.images || {}).packaging, slot: 'packaging', label: 'Packaging', opts: opts, height: 420,
      })], { center: true }));
      wrap.appendChild(grid);
      wrap.appendChild(fieldBox({
        label: 'Packaging-Hinweise',
        path: 'fields/packNote',
        page: page, opts: opts,
        multiline: true, minH: 60,
        placeholder: 'z.B. Made in Turkey · Wash inside out · Important: keep this bag safe',
      }));
      wrap.appendChild(fieldBox({
        label: 'Extra Note',
        path: 'notes/extra',
        page: page, opts: opts,
        multiline: true, minH: 40,
      }));
    });
  };

  // ── Public API ────────────────────────────────────────────────────────

  function renderPage(page, opts) {
    opts = opts || {};
    var fn = TYPES[page.type];
    if (!fn) {
      return el('div', { text: 'Unbekannter Seitentyp: ' + page.type, style: { padding: '40px', color: '#888' } });
    }
    return fn(page, opts);
  }

  window.tpRender = {
    page: renderPage,
    STANDARD_MEASUREMENTS: STANDARD_MEASUREMENTS,
  };
})();

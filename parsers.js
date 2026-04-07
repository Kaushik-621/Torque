/* ═══════════════════════════════════════════
   CAN Data Visualiser — All Parsers
   DBC, CAN CSV/TRC, Turntide, Curtis, AR
   ═══════════════════════════════════════════ */

const Parsers = (() => {
  'use strict';

  /* ══════════════════════════════════════
     DBC PARSER
     ══════════════════════════════════════ */
  function parseDBC(text) {
    const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
    const messages = {};
    let cur = null;
    for (const line of lines) {
      const t = line.trim();
      const mm = t.match(/^BO_\s+(\d+)\s+(\w+)\s*:\s*(\d+)\s+(\w+)/);
      if (mm) {
        const id = parseInt(mm[1],10);
        if (id >= 0xC0000000) { cur = null; continue; }
        cur = { id, name: mm[2], dlc: parseInt(mm[3],10), sender: mm[4], signals: [] };
        messages[id] = cur;
        continue;
      }
      const sm = t.match(/^SG_\s+(\w+)\s*:\s*(\d+)\|(\d+)@([01])([+-])\s+\(([^,]+),([^)]+)\)\s+\[([^|]+)\|([^\]]+)\]\s+"([^"]*)"/);
      if (sm && cur) {
        cur.signals.push({
          name: sm[1], startBit: parseInt(sm[2],10), bitLength: parseInt(sm[3],10),
          byteOrder: sm[4]==='1'?'little_endian':'big_endian', signed: sm[5]==='-',
          factor: parseFloat(sm[6]), offset: parseFloat(sm[7]),
          min: parseFloat(sm[8]), max: parseFloat(sm[9]), unit: sm[10]
        });
      }
    }
    return messages;
  }

  /* ══════════════════════════════════════
     CAN LOG PARSER (CSV + TRC)
     ══════════════════════════════════════ */
  function parseCANLog(text, fileName) {
    const ext = (fileName || '').toLowerCase().split('.').pop();
    if (ext === 'trc') return parseTRC(text);
    return parseCANCSV(text);
  }

  function parseTRC(text) {
    const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
    const rows = [];
    for (const line of lines) {
      if (!line.trim() || line.trim().startsWith(';')) continue;
      const m = line.match(/\s*(\d+)\)\s+([\d.]+)\s+(\w+)\s+([0-9A-Fa-f]+)\s+(\d+)\s+(.*)/);
      if (m) {
        const ts = parseFloat(m[2]) / 1000.0; // ms → s
        const msgId = parseInt(m[4], 16);
        const hexData = m[6].trim().replace(/[^0-9A-Fa-f\s]/g,'').trim();
        if (!isNaN(ts) && !isNaN(msgId)) rows.push({ timestamp: ts, msgId, hexData });
      }
    }
    return rows;
  }

  function parseCANCSV(text) {
    const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').filter(l=>l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(/[,;\t]/).map(h=>h.trim().toLowerCase());
    let tsCol=-1, idCol=-1, dataCol=-1, timeIsMs=false, idIsHex=false;
    for (let i=0;i<headers.length;i++) {
      const h=headers[i];
      if (tsCol===-1&&(h.includes('time')||h.includes('stamp')||h==='t'||h==='ts')){
        tsCol=i; if(h.includes('(ms)')||h.includes('_ms')||h.includes(' ms'))timeIsMs=true;
      } else if(idCol===-1&&h.includes('id')&&!h.includes('message number')){
        idCol=i; if(h.includes('hex')||h.includes('(hex)'))idIsHex=true;
      } else if(dataCol===-1&&(h.includes('data')||h.includes('payload')||h.includes('byte'))&&!h.includes('length')&&!h.includes('len')&&!h.includes('dlc')){
        dataCol=i;
      }
    }
    if(tsCol===-1)tsCol=0; if(idCol===-1)idCol=1; if(dataCol===-1)dataCol=2;
    const rows=[], maxCol=Math.max(tsCol,idCol,dataCol);
    for(let i=1;i<lines.length;i++){
      const cols=lines[i].split(/[,;\t]/);
      if(cols.length<=maxCol)continue;
      let ts=parseFloat(cols[tsCol].trim()); if(timeIsMs)ts/=1000;
      let msgId; const idStr=cols[idCol].trim();
      if(idIsHex||idStr.startsWith('0x')||idStr.startsWith('0X'))msgId=parseInt(idStr.replace(/^0x/i,''),16);
      else if(/^[0-9]+$/.test(idStr))msgId=parseInt(idStr,10);
      else if(/^[0-9A-Fa-f]+$/.test(idStr))msgId=parseInt(idStr,16);
      else msgId=parseInt(idStr,10);
      if(isNaN(ts)||isNaN(msgId))continue;
      let dataStr=cols.slice(dataCol).join(' ').trim().replace(/0x/gi,'').replace(/[^0-9A-Fa-f\s]/g,'').trim();
      rows.push({timestamp:ts,msgId,hexData:dataStr});
    }
    return rows;
  }

  /* ══════════════════════════════════════
     CAN SIGNAL DECODER
     ══════════════════════════════════════ */
  function hexToBytes(hex) {
    const c=hex.replace(/\s+/g,''); const b=[];
    for(let i=0;i<c.length;i+=2) b.push(parseInt(c.substr(i,2),16));
    return b;
  }

  function decodeSignal(bytes, sig) {
    const{startBit,bitLength,byteOrder,signed,factor,offset}=sig;
    let raw=0n;
    if(byteOrder==='little_endian'){
      for(let i=0;i<bitLength;i++){const bp=startBit+i;const bi=Math.floor(bp/8);const bt=bp%8;if(bi<bytes.length&&(bytes[bi]>>bt)&1)raw|=(1n<<BigInt(i));}
    } else {
      let bp=startBit;for(let i=bitLength-1;i>=0;i--){const bi=Math.floor(bp/8);const bt=bp%8;if(bi<bytes.length&&(bytes[bi]>>(7-bt))&1)raw|=(1n<<BigInt(i));if(bt===0)bp=(bi+1)*8+7;else bp--;}
    }
    if(signed&&bitLength>1){const sb=1n<<BigInt(bitLength-1);if(raw>=sb)raw=raw-(1n<<BigInt(bitLength));}
    return Number(raw)*factor+offset;
  }

  function decodeAllCAN(dbcMessages, csvRows) {
    const decoded={}, byMsg={};
    for(const r of csvRows){if(!byMsg[r.msgId])byMsg[r.msgId]=[];byMsg[r.msgId].push(r);}
    for(const[idStr,msg]of Object.entries(dbcMessages)){
      const id=parseInt(idStr,10);const rows=byMsg[id];if(!rows)continue;
      for(const sig of msg.signals){
        const key=`${msg.name}::${sig.name}`;const pts=[];
        for(const r of rows){const b=hexToBytes(r.hexData);if(!b.length)continue;pts.push({t:r.timestamp,v:decodeSignal(b,sig)});}
        if(pts.length)decoded[key]={data:pts,unit:sig.unit||''};
      }
    }
    let tMin=Infinity,tMax=-Infinity;
    if(csvRows.length){tMin=csvRows[0].timestamp;tMax=csvRows[csvRows.length-1].timestamp;}
    return{decoded,tMin,tMax};
  }

  /* ══════════════════════════════════════
     TURNTIDE CSV PARSER
     Paired columns: Time(s), Value, empty, Time(s), Value, empty, ...
     ══════════════════════════════════════ */
  function parseTurntide(text) {
    const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').filter(l=>l.trim());
    if (lines.length < 2) return { decoded:{}, tMin:0, tMax:0 };
    const headerCols = lines[0].split(',');

    // Identify signal groups: each group is [Time col, Value col, empty col]
    const signals = [];
    for (let i = 0; i < headerCols.length; i++) {
      const h = headerCols[i].trim();
      if (h.startsWith('Time') && i + 1 < headerCols.length) {
        const valHeader = headerCols[i + 1].trim();
        if (valHeader && !valHeader.startsWith('Time')) {
          // Extract clean signal name: "1. Throttle Value  (3.05e-05)" → "Throttle Value"
          let name = valHeader.replace(/^\d+\.\s*/, '').trim();
          // Extract unit from the name if present (e.g., "Velocity RPM (1)" → unit "RPM")
          let unit = '';
          const unitMatch = name.match(/\b(RPM|A|V|Nm|DegC|%|kW|W)\b/i);
          if (unitMatch) unit = unitMatch[1];
          // Remove scale factor in parens at end
          name = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
          signals.push({ name, unit, timeCol: i, valCol: i + 1 });
        }
      }
    }

    const decoded = {};
    let tMin = Infinity, tMax = -Infinity;

    for (const sig of signals) {
      const pts = [];
      for (let r = 1; r < lines.length; r++) {
        const cols = lines[r].split(',');
        if (cols.length <= sig.valCol) continue;
        const t = parseFloat(cols[sig.timeCol]);
        const v = parseFloat(cols[sig.valCol]);
        if (isNaN(t) || isNaN(v)) continue;
        pts.push({ t, v });
        if (t < tMin) tMin = t;
        if (t > tMax) tMax = t;
      }
      if (pts.length) decoded[sig.name] = { data: pts, unit: sig.unit };
    }
    return { decoded, tMin, tMax };
  }

  /* ══════════════════════════════════════
     CURTIS EXCEL/CSV PARSER
     Reads "Scaled Data" sheet from xlsx, or CSV
     First col = Timestamp (seconds), rest = signals
     ══════════════════════════════════════ */
  function parseCurtis(workbook) {
    // Try multiple sheet names
    const candidates = ['Scaled Data', 'Scaled + Filtered Data', 'Sheet1'];
    let ws = null, sheetName = '';
    for (const name of candidates) {
      if (workbook.SheetNames.includes(name)) { ws = workbook.Sheets[name]; sheetName = name; break; }
    }
    if (!ws) { ws = workbook.Sheets[workbook.SheetNames[0]]; sheetName = workbook.SheetNames[0]; }

    const jsonData = XLSX.utils.sheet_to_json(ws, { header: 1 });
    if (jsonData.length < 2) return { decoded:{}, tMin:0, tMax:0 };

    const headers = jsonData[0];
    // Find timestamp column (usually first)
    let tsCol = 0;
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] || '').toLowerCase();
      if (h.includes('timestamp') || h.includes('time')) { tsCol = i; break; }
    }

    // Skip non-numeric columns like "PC Clock"
    const signals = [];
    for (let i = 0; i < headers.length; i++) {
      if (i === tsCol) continue;
      const h = String(headers[i] || '').trim();
      if (!h) continue;
      // Skip date/clock columns
      const firstVal = jsonData.length > 1 ? jsonData[1][i] : null;
      if (typeof firstVal === 'string' && firstVal.includes('-')) continue; // date string
      if (typeof firstVal !== 'number' && isNaN(parseFloat(firstVal))) continue;
      // Extract unit from header like "Motor_RPM (rpm)"
      let unit = '';
      const um = h.match(/\(([^)]+)\)\s*$/);
      if (um) unit = um[1];
      const name = h.replace(/\s*\([^)]*\)\s*$/, '').trim();
      signals.push({ name, unit, col: i });
    }

    const decoded = {};
    let tMin = Infinity, tMax = -Infinity;

    for (const sig of signals) {
      const pts = [];
      for (let r = 1; r < jsonData.length; r++) {
        const row = jsonData[r];
        if (!row || row.length <= Math.max(tsCol, sig.col)) continue;
        const t = parseFloat(row[tsCol]);
        const v = parseFloat(row[sig.col]);
        if (isNaN(t) || isNaN(v)) continue;
        pts.push({ t, v });
        if (t < tMin) tMin = t;
        if (t > tMax) tMax = t;
      }
      if (pts.length) decoded[sig.name] = { data: pts, unit: sig.unit };
    }
    return { decoded, tMin, tMax };
  }

  /* ══════════════════════════════════════
     AR / GENERAL CSV/EXCEL PARSER
     Auto-detect time column, parse all numeric columns
     Handles µs, ms, s time units
     ══════════════════════════════════════ */
  function parseGeneral(data, isWorkbook) {
    let headers, rows;

    if (isWorkbook) {
      const ws = data.Sheets[data.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { header: 1 });
      if (json.length < 2) return { decoded:{}, tMin:0, tMax:0 };
      headers = json[0];
      rows = json.slice(1);
    } else {
      // CSV text
      const lines = data.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').filter(l=>l.trim());
      if (lines.length < 2) return { decoded:{}, tMin:0, tMax:0 };
      headers = lines[0].split(/[,;\t]/).map(h => h.trim());
      rows = lines.slice(1).map(l => l.split(/[,;\t]/).map(c => c.trim()));
    }

    // Find time column
    let tsCol = 0;
    let timeDivisor = 1; // conversion to seconds
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] || '').toLowerCase();
      if (h.includes('time') || h.includes('stamp') || h === 't') {
        tsCol = i;
        if (h.includes('usec') || h.includes('µs') || h.includes('microsec')) timeDivisor = 1e6;
        else if (h.includes('ms') || h.includes('millisec')) timeDivisor = 1000;
        break;
      }
    }

    const signals = [];
    for (let i = 0; i < headers.length; i++) {
      if (i === tsCol) continue;
      const h = String(headers[i] || '').trim();
      if (!h) continue;
      // Check first data value is numeric
      const firstVal = rows[0] ? rows[0][i] : null;
      if (firstVal !== undefined && isNaN(parseFloat(firstVal))) continue;
      let unit = '';
      const um = h.match(/\[([^\]]+)\]|\(([^)]+)\)/);
      if (um) unit = um[1] || um[2] || '';
      const name = h.replace(/\s*[\[\(][^\]\)]*[\]\)]\s*/g, '').trim();
      signals.push({ name, unit, col: i });
    }

    const decoded = {};
    let tMin = Infinity, tMax = -Infinity;

    for (const sig of signals) {
      const pts = [];
      for (const row of rows) {
        if (!row || row.length <= Math.max(tsCol, sig.col)) continue;
        const t = parseFloat(row[tsCol]) / timeDivisor;
        const v = parseFloat(row[sig.col]);
        if (isNaN(t) || isNaN(v)) continue;
        pts.push({ t, v });
        if (t < tMin) tMin = t;
        if (t > tMax) tMax = t;
      }
      if (pts.length) decoded[sig.name] = { data: pts, unit: sig.unit };
    }
    return { decoded, tMin, tMax };
  }

  return { parseDBC, parseCANLog, hexToBytes, decodeSignal, decodeAllCAN, parseTurntide, parseCurtis, parseGeneral };
})();

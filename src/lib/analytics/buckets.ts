export function widthBucket(width: number): '1-24' | '25-50' | '51-100' | '101-150' | '151-200' {
  if (width <= 24) return '1-24';
  if (width <= 50) return '25-50';
  if (width <= 100) return '51-100';
  if (width <= 150) return '101-150';
  return '151-200';
}

export function colorBucket(count: number): '1-24' | '25-48' | '49-72' | '73-96' | '97-144' | '145+' {
  if (count <= 24) return '1-24';
  if (count <= 48) return '25-48';
  if (count <= 72) return '49-72';
  if (count <= 96) return '73-96';
  if (count <= 144) return '97-144';
  return '145+';
}

export function fileSizeBucket(bytes: number): '0-1m' | '1-5m' | '5-10m' | '10-20m' {
  const mib = bytes / (1024 * 1024);
  if (mib <= 1) return '0-1m';
  if (mib <= 5) return '1-5m';
  if (mib <= 10) return '5-10m';
  return '10-20m';
}

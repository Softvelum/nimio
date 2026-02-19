export function currentTimeGetterMs() {
  function getPerfTime() {
    return performance.now();
  }

  function getCurrentTime() {
    return currentTime * 1000;
  }

  let hasPerformance = typeof performance !== "undefined";
  return hasPerformance ? getPerfTime : getCurrentTime;
}

export function secondsToHumanClock (sec, emptyVal = '0') {
  if (sec < 0) return '--';
  sec = Math.round(sec);

  let full = '';
  let days = Math.floor(sec / 86400);
  if( days > 0 ) {
    full += days + 'd ';
  }
  let rest = sec - days * 86400;
  if( rest !== 0 ) {
    let hours = Math.floor(rest / 3600);
    let space = (full.length > 0) ? ' ' : '';
    if (hours > 0) {
      full += space + ( (hours < 10) ? '0' + hours : hours ) + ':';
    }

    rest -= hours * 3600;
    let minutes = Math.floor(rest / 60);
    full += ( (minutes < 10) ? '0' + minutes : minutes ) + ':';

    let seconds = rest - minutes * 60;
    full += ( (seconds < 10) ? '0' + seconds : seconds );
  }

  return ( 0 === full.length ) ? emptyVal : full;
}

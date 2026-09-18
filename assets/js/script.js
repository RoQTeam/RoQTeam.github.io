const vid = document.getElementById('bgvid');
const overlay = document.querySelector('.wipe-overlay');

if (vid && overlay) vid.addEventListener('timeupdate', () => {
  const wipeDuration = 5; // seconds
  if (vid.duration - vid.currentTime <= wipeDuration) {
    overlay.style.clipPath = 'inset(0 0 0 0)'; // reveal from right
  } else if (vid.currentTime < wipeDuration) {
    overlay.style.clipPath = 'inset(0 100% 0 0)'; // hide again
  }
});

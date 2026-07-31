const lightbox = document.querySelector('.lightbox');
const lightboxImage = lightbox.querySelector('img');

document.querySelectorAll('.shot').forEach((shot) => {
  shot.addEventListener('click', () => {
    lightboxImage.src = shot.dataset.image;
    lightboxImage.alt = shot.dataset.alt;
    lightbox.showModal();
  });
});

lightbox.querySelector('.close').addEventListener('click', () => lightbox.close());
lightbox.addEventListener('click', (event) => {
  if (event.target === lightbox) lightbox.close();
});

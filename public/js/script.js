document.addEventListener('DOMContentLoaded', () => {
    const navbar = document.querySelector('.navbar');
    if (navbar) { 
        const checkScroll = () => {
            if (window.scrollY > 50) {
                navbar.classList.add('navbar-scrolled');
            } else {
                navbar.classList.remove('navbar-scrolled');
            }
        };
        window.addEventListener('scroll', checkScroll);
        checkScroll();
    }
    const lazyImages = document.querySelectorAll('.lazy-load-image');

    if (lazyImages.length > 0 && 'IntersectionObserver' in window) {
        
        const observer = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const dataSrc = img.getAttribute('data-src');
                    if (dataSrc) {
                        img.src = dataSrc; 
                        img.removeAttribute('data-src');
                    }
                    observer.unobserve(img);
                }
            });
        }, { 
            rootMargin: '0px 0px 100px 0px' 
        });
        lazyImages.forEach(img => {
            observer.observe(img);
        });
    } 
});
document.getElementById("tahun").innerHTML = new Date().getFullYear();
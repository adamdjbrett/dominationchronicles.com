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

    const lazyElements = document.querySelectorAll('.lazy-load-image, picture source');

    if (lazyElements.length > 0 && 'IntersectionObserver' in window) {
        
        const loadElement = (element) => {
            const dataSrc = element.getAttribute('data-src');
            const dataSrcSet = element.getAttribute('data-srcset');
            const dataSizes = element.getAttribute('data-sizes');
            
            if (dataSrcSet) {
                element.setAttribute('srcset', dataSrcSet);
                element.removeAttribute('data-srcset');
            }
            if (dataSizes) {
                element.setAttribute('sizes', dataSizes);
                element.removeAttribute('data-sizes');
            }
            
            if (element.tagName === 'IMG' && dataSrc) {
                element.src = dataSrc; 
                element.removeAttribute('data-src');
                
                // Hapus kelas setelah dimuat
                element.classList.remove('lazy-load-image');
            }
        };

        const observer = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const element = entry.target;
                    
                    loadElement(element);
                    
                    observer.unobserve(element);
                }
            });
        }, { 
            rootMargin: '0px 0px 200px 0px' 
        });

        lazyElements.forEach(element => {
            observer.observe(element);
        });
    } 
    const tahunElement = document.getElementById("tahun");
    if (tahunElement) {
        tahunElement.innerHTML = new Date().getFullYear();
    }
});
/*
  Cart drawer upsell.

  Tracking — every upsell add is identifiable in 3 ways:
  1. Order admin: the line item carries the hidden property `_upsell_source: Cart Drawer Upsell`
     (underscore = hidden from the customer, visible on the order in Shopify admin).
  2. Shopify Customer Events: custom events `cart_upsell_viewed` and `cart_upsell_added`
     via Shopify.analytics.publish (subscribe to them in a custom pixel).
  3. GTM / GA4 / Meta: dataLayer push (`cart_upsell_view`, `cart_upsell_add`), gtag event and
     fbq custom event when those tools are on the page.
*/
if (!customElements.get('cart-upsell')) {
  const viewedProducts = new Set();

  const track = (name, payload) => {
    try {
      window.Shopify?.analytics?.publish?.(`cart_upsell_${name === 'add' ? 'added' : 'viewed'}`, payload);
    } catch (e) {}

    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ ecommerce: null });
      window.dataLayer.push({
        event: `cart_upsell_${name}`,
        upsell_source: payload.source,
        ecommerce: {
          currency: payload.currency,
          value: payload.price,
          item_list_name: payload.source,
          items: [
            {
              item_id: String(payload.product_id),
              item_name: payload.product_title,
              item_variant: String(payload.variant_id || ''),
              price: payload.price,
              index: payload.position,
              quantity: 1,
            },
          ],
        },
      });
    } catch (e) {}

    if (name !== 'add') return;

    try {
      if (typeof window.gtag === 'function') {
        window.gtag('event', 'cart_upsell_add', {
          product_id: payload.product_id,
          product_title: payload.product_title,
          variant_id: payload.variant_id,
          value: payload.price,
          currency: payload.currency,
        });
      }
    } catch (e) {}

    try {
      if (typeof window.fbq === 'function') {
        window.fbq('trackCustom', 'CartUpsellAdd', {
          content_ids: [String(payload.product_id)],
          content_name: payload.product_title,
          value: payload.price,
          currency: payload.currency,
        });
      }
    } catch (e) {}
  };

  customElements.define(
    'cart-upsell',
    class CartUpsell extends HTMLElement {
      connectedCallback() {
        this.track = this.querySelector('[data-upsell-track]');
        this.errorEl = this.querySelector('[data-upsell-error]');

        this.addEventListener('click', this.onClick.bind(this));
        // Stop variant <select> changes from reaching <cart-drawer-items>, which treats any
        // change event as a quantity update.
        this.addEventListener('change', (event) => {
          event.stopPropagation();
          if (event.target.matches('[data-upsell-variant]')) this.onVariantChange(event.target);
        });

        this.observeViews();
      }

      disconnectedCallback() {
        this.observer?.disconnect();
      }

      observeViews() {
        if (!('IntersectionObserver' in window)) return;
        this.observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) return;
              const card = entry.target;
              this.observer.unobserve(card);
              if (viewedProducts.has(card.dataset.productId)) return;
              viewedProducts.add(card.dataset.productId);
              track('view', this.payloadFor(card));
            });
          },
          { threshold: 0.6 }
        );
        this.querySelectorAll('.cart-upsell__card').forEach((card) => this.observer.observe(card));
      }

      payloadFor(card) {
        const button = card.querySelector('[data-upsell-add]');
        return {
          source: this.dataset.source,
          product_id: Number(card.dataset.productId),
          product_title: card.dataset.productTitle,
          variant_id: Number(button.dataset.variantId),
          position: Number(card.dataset.position),
          price: Number(button.dataset.priceCents) / 100,
          currency: window.Shopify?.currency?.active,
        };
      }

      onClick(event) {
        const prev = event.target.closest('[data-upsell-prev]');
        const next = event.target.closest('[data-upsell-next]');
        if (prev || next) {
          const card = this.querySelector('.cart-upsell__card');
          const step = card ? card.offsetWidth + 12 : this.track.clientWidth * 0.8;
          this.track.scrollBy({ left: next ? step : -step, behavior: 'smooth' });
          return;
        }

        const button = event.target.closest('[data-upsell-add]');
        if (button) this.addToCart(button);
      }

      onVariantChange(select) {
        const card = select.closest('.cart-upsell__card');
        const option = select.selectedOptions[0];
        const button = card.querySelector('[data-upsell-add]');
        button.dataset.variantId = select.value;
        button.dataset.priceCents = option.dataset.cents;
        card.querySelector('[data-upsell-price]').textContent = option.dataset.price;
        card.querySelector('[data-upsell-compare]').textContent = option.dataset.compare;
        card.querySelector('[data-upsell-save]').textContent = option.dataset.save;
        card.querySelector('.cart-upsell__badge').hidden = !option.dataset.save;
      }

      addToCart(button) {
        if (button.classList.contains('loading')) return;
        const card = button.closest('.cart-upsell__card');
        const cartDrawer = document.querySelector('cart-drawer');
        const payload = this.payloadFor(card);

        button.classList.add('loading');
        button.setAttribute('aria-disabled', 'true');
        this.errorEl.hidden = true;

        const body = JSON.stringify({
          items: [
            {
              id: payload.variant_id,
              quantity: 1,
              properties: { _upsell_source: this.dataset.source },
            },
          ],
          sections: cartDrawer.getSectionsToRender().map((section) => section.id),
          sections_url: window.location.pathname,
        });

        fetch(`${routes.cart_add_url}.js`, { ...fetchConfig('javascript'), body })
          .then((response) => response.json())
          .then((response) => {
            if (response.status) {
              this.errorEl.textContent = response.description || response.message || window.cartStrings?.error;
              this.errorEl.hidden = false;
              return;
            }

            track('add', payload);
            document.dispatchEvent(new CustomEvent('cart-upsell:added', { detail: payload }));
            cartDrawer.renderContents(response);
          })
          .catch(() => {
            this.errorEl.textContent = window.cartStrings?.error || 'Something went wrong.';
            this.errorEl.hidden = false;
          })
          .finally(() => {
            button.classList.remove('loading');
            button.removeAttribute('aria-disabled');
          });
      }
    }
  );
}

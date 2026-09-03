// The page itself is a client component, so it can't export metadata — this server layout
// carries the title for the route instead. The order code is already visible in the URL and
// on the page, so echoing it in the title just makes a tab full of orders tellable apart.
export async function generateMetadata({ params }) {
  const { code } = await params
  return { title: `Order ${String(code || '').toUpperCase()}` }
}

export default function OrderLayout({ children }) {
  return children
}

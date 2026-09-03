// Client page → metadata lives in this server layout. See app/order/[code]/layout.js.
export async function generateMetadata({ params }) {
  const { num } = await params
  return { title: `Transaction #${num}` }
}

export default function TransactionLayout({ children }) {
  return children
}

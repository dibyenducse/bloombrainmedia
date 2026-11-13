import Ledger from '../payments/ledger';
import '../payments/payments.css';
export const metadata={title:'Admin — BloomBrain Media',robots:{index:false,follow:false},referrer:'no-referrer'};
export default function Page(){return <Ledger mode="admin"/>}

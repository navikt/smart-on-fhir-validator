import './Spinner.css'

const Spinner = ({ text }: { text: string }) => {
    return (
        <div className="mt-8 p-2 max-w-96 flex flex-col gap-3 items-center justify-center">
            <div className="loader"></div>
            <p className="italic">{text}</p>
        </div>
    )
}

export default Spinner

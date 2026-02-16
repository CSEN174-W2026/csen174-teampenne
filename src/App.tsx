export default function App() {
  return (
    <div className="min-h-screen flex">

      {/* LEFT PANEL (fixed, 40%) */}
      <div className="w-[40%] fixed h-screen bg-green-400 text-white p-12 flex flex-col justify-between">

        {/* Header */}
        <div className="flex justify-between items-center">
          <h1 className="font-semibold text-lg">AIMSE</h1>
          <button className="bg-blue-900 px-4 py-2 rounded-md">
            Get started
          </button>
        </div>

        {/* Hero Section */}
        <div>
          <h2 className="text-5xl font-light mb-6">
            A System <br />
            Manager For You
          </h2>

          <p className="text-lg text-green-100 mb-10">
            Learn how and why your system manager makes each choice.
          </p>

          <div className="flex gap-5">
            <FeatureCard title="Instant Productivity" />
            <FeatureCard title="Accessible Anywhere" />
            <FeatureCard title="Advanced Technology" />
          </div>
        </div>

        {/* Footer */}
        <div className="text-sm text-green-100 flex gap-6">
          <span>Contact</span>
          <span>Social</span>
          <span>Address</span>
          <span>Legal Terms</span>
        </div>
      </div>

      {/* RIGHT PANEL (scrollable, 60%) */}
      <div className="ml-[40%] w-[60%] bg-gray-100 p-16 flex flex-col gap-16">

        <div className="h-[420px] bg-gray-300 rounded-3xl" />

        <div className="text-center">
          <h3 className="text-2xl font-medium">
            We Merge Agentic Systems and Learning About Them Into One
          </h3>
        </div>

        <div className="text-center">
          <h2 className="text-4xl text-green-500 font-light">
            Run Tasks Anywhere And Everywhere
          </h2>
          <p className="text-gray-500 mt-4">
            Maximize your productivity with smarter tools.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-10">
          <StatCard value="2x" label="Double Your Productivity" />
          <StatCard value="130%" label="More Activity" />
          <StatCard value="∞" label="Centralize Your Finances" />
          <StatCard value="↑" label="Efficiency Increase" />
        </div>

        {/* Placeholder sections to force scrolling */}
        <PlaceholderBlock />
        <PlaceholderBlock />
        <PlaceholderBlock />

      </div>
    </div>
  )
}

function FeatureCard({ title }: { title: string }) {
  return (
    <div className="
      flex flex-col
      justify-center
      items-center
      flex-1
      h-[120px]
      py-5 px-2
      gap-3
      bg-[#22577A]
      rounded
      text-center
    ">
      <p className="text-green-300 text-sm">
        {title}
      </p>
    </div>
  )
}
function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="
      flex flex-col
      justify-end
      items-center
      gap-5
      px-5 py-8
      h-[222px]
      min-w-[275px]
      bg-[#22577A]
      rounded-lg
      text-center
    ">
      <div className="text-5xl text-green-400 font-light">
        {value}
      </div>

      <div className="text-green-300 text-sm">
        {label}
      </div>
    </div>
  )
}


function PlaceholderBlock() {
  return (
    <div className="bg-white rounded-3xl shadow-lg p-24 text-center">
      <h4 className="text-2xl font-light text-gray-700">
        Additional Section Placeholder
      </h4>
      <p className="text-gray-500 mt-4">
        This exists to demonstrate scroll behavior on the right panel.
      </p>
    </div>
  )
}

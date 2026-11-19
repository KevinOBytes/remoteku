cask "remoteku" do
  arch arm: "-arm64", intel: ""

  version "2.1.0"
  sha256 arm:   "03616d484571178eecd434af097d8af1289598017ccf5ec4feba912e5b24321f",
         intel: "60438049169118ab69b36252e9d5670b67407da063a2283ff915dec9cdf4134c"

  url "https://github.com/KevinOBytes/remoteku/releases/download/v#{version}/RemoteKu-#{version}#{arch}.dmg"
  name "RemoteKu"
  desc "Roku remote control and live ECP command deck"
  homepage "https://github.com/KevinOBytes/remoteku"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates false
  depends_on macos: ">= :catalina"

  app "RemoteKu.app"

  zap trash: [
    "~/Library/Application Support/remoteku",
    "~/Library/Preferences/com.kevinobytes.remoteku.plist",
    "~/Library/Saved Application State/com.kevinobytes.remoteku.savedState",
  ]
end

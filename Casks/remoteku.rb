cask "remoteku" do
  arch arm: "-arm64", intel: ""

  version "2.1.0"
  sha256 arm:   "8485d65f76ee044359e07e84d95fce6212ed7875dba54897cdb90923e1cd6ff8",
         intel: "72d78397c72a86797a84a705a4d1f582b2291b426573289622a611bc2d56e17d"

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

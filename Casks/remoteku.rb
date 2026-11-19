cask "remoteku" do
  arch arm: "-arm64", intel: ""

  version "2.0.0"
  sha256 arm: "5b58c334c75665ac2eb0fea84a5697010471c36ca2cf32f91ebcf8f1b621ffc2"

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
